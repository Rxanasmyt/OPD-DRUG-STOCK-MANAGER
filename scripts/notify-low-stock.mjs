#!/usr/bin/env node
// Real-world request: "แจ้งเตือนผ่าน LINE เมื่อยาต่ำกว่า par" — this app is a static site with
// no backend (see src/utils/notify.ts's own doc comment on why: no paid Cloud Functions plan
// just to run a schedule), so nothing in the browser can push a real notification once the tab
// is closed. Same free-tier answer as scripts/backup-firestore.mjs: GitHub Actions IS the
// server. This script reads today's real stock numbers via the Firebase Admin SDK (read-only)
// and broadcasts a LINE message via the Messaging API's Broadcast endpoint — sent to every
// account that has added the hospital's LINE Official Account as a friend, so there is no
// per-user/group ID to manage: everyone who wants the alert just adds the OA once.
//
// Skips sending entirely (not even an empty "all clear" ping) when nothing is actually low —
// a notification only earns its interruption when there's real work attached to it.
//
// Auth: FIREBASE_SERVICE_ACCOUNT_KEY (same secret backup-firestore.mjs uses) +
// LINE_CHANNEL_ACCESS_TOKEN (from the LINE Developers Console — see this repo's
// .github/workflows/low-stock-notify.yml for the one-time setup steps).
//
// To run locally:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" \
//   LINE_CHANNEL_ACCESS_TOKEN="..." node scripts/notify-low-stock.mjs
//   Add --dry-run to print the message instead of actually sending it.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APP_URL = 'https://rxanasmyt.github.io/OPD-DRUG-STOCK-MANAGER/';
const MAX_ROWS_PER_SECTION = 15; // keeps the broadcast readable — the app itself has the full list

// Kept in sync BY HAND with src/store/selectors.ts (floorMinOf/isUrgentLow/usesSubstock) — this
// script runs outside the TS/Vite build, so it can't import those directly. If those formulas
// change, update this block too.
//
// Bug fix (audit finding — false LINE alert): this used to trust ANY stored `m.floorMin`, even
// one greater than the med's own `parFloor` (Max) — a real, reachable data state (legacy data,
// a manual Firestore edit, or an old pre-guard write; see AppContext.tsx's applyOnePar/
// applyAllSuggested, which both explicitly re-derive floorMin whenever applying a par suggestion
// would otherwise leave it above the new Max, precisely because this state is known to happen).
// selectors.ts's real floorMinOf() guards against it (`m.floorMin <= m.parFloor`), falling back
// to the 50%-of-Max default — this copy didn't, so a med sitting in that stale state would get a
// too-high Min here while the app itself (and its "ต่ำกว่า Min" screens) already uses the
// correct, lower one, producing a false "ต่ำกว่า Min" broadcast to every LINE OA follower for a
// med the app itself does not consider low.
function floorMinOf(m) {
  // Same as selectors.ts: a stored Min <= 0 means "never set"; the fallback is floored at 1 for Max >= 1
  // so an empty shelf is always "low".
  if (typeof m.floorMin === 'number' && m.floorMin <= m.parFloor) return m.floorMin;
  const raw = (m.parFloor || 0) * 0.5;
  if (raw <= 0) return 0;
  const step = raw >= 500 ? 100 : raw >= 100 ? 10 : raw >= 10 ? 5 : 1;
  // Clamp to at most one below parFloor, same as selectors.ts (a tiny parFloor rounds back up).
  const half = Math.min(Math.round(raw / step) * step, m.parFloor - 1);
  return m.parFloor >= 1 ? Math.max(1, half) : half;
}
function usesSubstock(m) { return !m.noSubstock; }
// Mirrors selectors.ts's isOnStockHold(): a med flagged "ยาขาดชั่วคราว" is never worth a LINE
// alert — nothing refilling/requisitioning can fix a broken supply chain, and the app itself
// excludes it from every low-stock list.
function isOnStockHold(m) { return typeof m.outOfStockSince === 'number'; }

async function lineBroadcast(token, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE broadcast failed: ${res.status} ${res.statusText} — ${body}`);
  }
}

// Second channel (same one the EB Notify app uses): MOPH Notify posts into a LINE GROUP that has the "หมอพร้อม" bot in it,
// using the unit's client-key / secret-key from the MOPH Notify CMS (API_Document_MOPH_Notify). Success = HTTP 2xx AND
// message_code 200 — the API reports failures (wrong key, bad message format) as `message_code: 401` in the body.
export async function mophNotify(clientKey, secretKey, messages) {
  const res = await fetch('https://morpromt2f.moph.go.th/api/notify/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'client-key': clientKey, 'secret-key': secretKey },
    body: JSON.stringify({ messages }),
  });
  const raw = await res.text().catch(() => '');
  let code;
  try { code = JSON.parse(raw).message_code; } catch { /* non-JSON body */ }
  if (!res.ok || (code !== undefined && Number(code) !== 200)) {
    throw new Error(`MOPH Notify failed: ${res.status} — ${raw.slice(0, 200)}`);
  }
}

const DAY_MS = 86400000;
const BKK = 7 * 3600000;
const bkkDay = (ms) => new Date(ms + BKK).toISOString().slice(0, 10);
const nf = (n) => Number(n || 0).toLocaleString('en-US');

// Same rule as selectors.ts's needsZeroFloorCheck(): an active, non-hold med whose shelf shows 0 although it normally has stock
// (parFloor / recent usage), unless somebody already counted it today (Bangkok date).
function needsZeroFloorCheck(m, now) {
  if (!m.active || isOnStockHold(m) || m.floor !== 0) return false;
  if (!((m.parFloor || 0) > 0 || (m.used30 || 0) > 0)) return false;
  const last = m.lastCountTs;
  if (typeof last === 'number' && isFinite(last) && bkkDay(last) === bkkDay(now)) return false;
  return true;
}

/** Pure: everything the notification says, computed from already-read data. Exported for tests. */
// Emergency requisition: the warehouse is requisitioned about every 2 weeks and stock arrives ~1 week after the request, so a drug
// whose TOTAL on-hand (shelf + substock) will run out before the next regular delivery cannot wait for the normal round.
// `horizonDays` = how far ahead to look: default 7 days (a drug that will run out within a week is flagged); a hospital can change it
// with REQ_HORIZON_DAYS, or set NEXT_DELIVERY_DATE to look exactly as far as the next regular delivery.
// Daily use is the calendar-day average of the same blended monthly figure the app's par suggestion uses.
function monthlyUse(m) {
  const cur = m.used30 || 0; const prev = m.usedPrev30 || 0;
  return prev > 0 ? Math.max(cur * 0.7 + prev * 0.3, (cur + prev) / 2) : cur;
}

/** Urgency ladder for the emergency list, by whole days of cover left. */
export function urgencyLevel(coverDays) {
  if (coverDays <= 1) return { n: 1, label: 'วิกฤต', sub: 'หมดวันนี้–พรุ่งนี้', ink: '#B71C1C', bg: '#FFCDD2', dot: '🔴' };
  if (coverDays <= 3) return { n: 2, label: 'เร่งด่วนมาก', sub: 'หมดใน 2–3 วัน', ink: '#D84315', bg: '#FFE0B2', dot: '🟠' };
  return { n: 3, label: 'เร่งด่วน', sub: 'หมดใน 4–7 วัน', ink: '#9A5B00', bg: '#FFF8C4', dot: '🟡' };
}

export function buildReport({ meds, lots, expiryWarnDays = 30, now = Date.now(), horizonDays = 7 }) {
  const active = meds.filter((m) => m.active);
  const byId = new Map(active.map((m) => [m.id, m]));
  const subByMed = new Map();
  const expiring = [];
  for (const l of lots) {
    if (!(l.qty > 0)) continue;
    subByMed.set(l.medId, (subByMed.get(l.medId) || 0) + l.qty);
    const m = byId.get(l.medId);
    // The "ปรับยอด (นับสต็อก)" placeholder lot has no real expiry (set ~100 years out) — never worth an expiry alert.
    if (!m || typeof l.exp !== 'number' || l.exp > now + 50 * 365 * DAY_MS) continue;
    const days = Math.floor((l.exp - now) / DAY_MS);
    if (days < expiryWarnDays) expiring.push({ name: m.name, unit: m.unit, lotNo: l.lotNo, qty: l.qty, days });
  }
  expiring.sort((a, b) => a.days - b.days);
  const subQty = (id) => subByMed.get(id) || 0;
  const belowMin = active.filter((m) => !isOnStockHold(m) && (m.floor || 0) < floorMinOf(m))
    .map((m) => ({ name: m.name, unit: m.unit, cur: m.floor || 0, ref: floorMinOf(m) }));
  const belowSubParAll = active.filter((m) => !isOnStockHold(m) && (usesSubstock(m) ? subQty(m.id) < (m.parSub || 0) : (m.floor || 0) < (m.parFloor || 0)))
    .map((m) => usesSubstock(m)
      ? { name: m.name, unit: m.unit, cur: subQty(m.id), ref: m.parSub || 0 }
      : { name: m.name, unit: m.unit, cur: m.floor || 0, ref: m.parFloor || 0 });
  const emergency = active
    .filter((m) => !isOnStockHold(m) && monthlyUse(m) > 0)
    .map((m) => {
      const daily = monthlyUse(m) / 30;
      const onHand = (m.floor || 0) + subQty(m.id);
      return { m, daily, onHand, cover: onHand / daily };
    })
    .filter((x) => x.cover <= horizonDays)
    .sort((a, b) => a.cover - b.cover)
    .map((x) => ({
      name: x.m.name, unit: x.m.unit, onHand: x.onHand, cover: Math.max(0, Math.floor(x.cover)), level: urgencyLevel(Math.max(0, Math.floor(x.cover))),
      // enough to carry the drug through the horizon plus a week of lead time, never less than topping substock up to par
      needQty: Math.max(0, Math.ceil(x.daily * (horizonDays + 7) - x.onHand), (usesSubstock(x.m) ? (x.m.parSub || 0) - subQty(x.m.id) : 0)),
    }));
  const emergencyNames = new Set(emergency.map((e) => e.name));
  const zeroFloor = active.filter((m) => needsZeroFloorCheck(m, now)).map((m) => ({ name: m.name, unit: m.unit }));
  // A zero-floor med is always below Min too; list it once (under "ยอด 0 ควรนับจริง", the action it actually needs) instead of
  // repeating it in two sections of the same message.
  // Same for par: a drug already in the emergency list is not repeated under "ต่ำกว่า par".
  const belowSubPar = belowSubParAll.filter((r) => !emergencyNames.has(r.name));
  const zeroNames = new Set(zeroFloor.map((z) => z.name));
  const belowMinShown = belowMin.filter((r) => !zeroNames.has(r.name));
  return { emergency, horizonDays, belowMin: belowMinShown, belowSubPar, zeroFloor, expiring, expiryWarnDays, empty: !emergency.length && !belowMinShown.length && !belowSubPar.length && !zeroFloor.length && !expiring.length };
}

const SECTIONS = [
  { key: 'emergency', icon: '🚨', color: '#B71C1C', title: 'เบิกฉุกเฉิน — จะหมดก่อนถึงรอบเบิกปกติ', fmt: (r) => `${r.level.dot} ${r.level.label} · เหลือใช้ ~${r.cover} วัน · คงเหลือ ${nf(r.onHand)} ${r.unit} · ควรขอ ~${nf(r.needQty)}`, valueText: (r) => `${r.level.label} · ~${r.cover} วัน` },
  { key: 'belowMin', icon: '🔴', color: '#C62828', title: 'ต่ำกว่าจุดต้องเติม (Min) — ควรเติมวันนี้', fmt: (r) => `${nf(r.cur)}/${nf(r.ref)} ${r.unit}`, valueText: (r) => `${nf(r.cur)}/${nf(r.ref)}` },
  { key: 'zeroFloor', icon: '0️⃣', color: '#6A1B9A', title: 'ยอดหน้างานเป็น 0 — ควรนับจริง', fmt: () => 'ยังไม่ได้นับวันนี้', valueText: () => '0' },
  { key: 'belowSubPar', icon: '🟡', color: '#B26A00', title: 'ต่ำกว่า par — ควรเบิกจากคลังใหญ่', fmt: (r) => `${nf(r.cur)}/${nf(r.ref)} ${r.unit}`, valueText: (r) => `${nf(r.cur)}/${nf(r.ref)}` },
  { key: 'expiring', icon: '⏳', color: '#E65100', title: 'ใกล้หมดอายุ', fmt: (r) => `${r.lotNo ? 'lot ' + r.lotNo + ' · ' : ''}${nf(r.qty)} ${r.unit} · ${r.days < 0 ? 'หมดอายุแล้ว ' + Math.abs(r.days) + ' วัน' : 'อีก ' + r.days + ' วัน'}` },
];

export function dateLabelBkk(now = Date.now()) {
  // Runs on a UTC GitHub runner — without an explicit timeZone the date would be a day behind in Bangkok for part of the day.
  return new Date(now).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

/** Plain-text version (LINE OA broadcast + dry-run printout). */
export function buildText(report, dateLabel) {
  let text = `📋 แจ้งเตือนสต็อกยา รพ.กรงปินัง\n${dateLabel}`;
  for (const sec of SECTIONS) {
    const rows = report[sec.key];
    if (!rows.length) continue;
    const shown = rows.slice(0, MAX_ROWS_PER_SECTION);
    const more = rows.length > shown.length ? `\n…และอีก ${rows.length - shown.length} รายการ` : '';
    const title = sec.key === 'expiring' ? `${sec.title} (< ${report.expiryWarnDays} วัน)` : sec.title;
    text += `\n\n${sec.icon} ${title} (${rows.length} รายการ)\n` + shown.map((r) => `• ${r.name}: ${sec.fmt(r)}`).join('\n') + more;
  }
  return text + `\n\nเปิดแอพ: ${APP_URL}`;
}

// ---- Flex message design (MOPH Notify → LINE group) -------------------------------------------------------------------------
// LINE renders Flex natively: no custom fonts, CSS or animation are possible (the phone's own font is used). What IS
// available — and used here — is colour, gradients, size/weight hierarchy, emoji and simple bars. A carousel: first card is
// a colour-coded summary of the day, then one card per kind of alert, each in its own colour so severity reads at a glance.
const THEME = {
  emergency: { c1: '#FF1744', c2: '#8E0000', soft: '#FFEBEE', ink: '#B71C1C', label: 'เบิกฉุกเฉิน', sub: 'จะหมดก่อนถึงรอบเบิกปกติ' },
  belowMin: { c1: '#FF5F6D', c2: '#C62828', soft: '#FFEBEE', ink: '#B71C1C', label: 'ต่ำกว่า Min', sub: 'ควรเติมหน้างานวันนี้' },
  zeroFloor: { c1: '#B388FF', c2: '#6A1B9A', soft: '#F3E5F5', ink: '#6A1B9A', label: 'ยอด 0', sub: 'ควรนับจริงหน้างาน' },
  belowSubPar: { c1: '#FFC107', c2: '#E08A00', soft: '#FFF8E1', ink: '#9A5B00', label: 'ต่ำกว่า par', sub: 'ควรเบิกจากคลังใหญ่' },
  expiring: { c1: '#FF9A5A', c2: '#E64A19', soft: '#FBE9E7', ink: '#BF360C', label: 'ใกล้หมดอายุ', sub: 'ตรวจและส่งคืน/ใช้ก่อน' },
};
const grad = (c1, c2) => ({ type: 'linearGradient', angle: '135deg', startColor: c1, endColor: c2 });
const ROWS_PER_CARD = 7;

function summaryBubble(report, dateLabel) {
  const tile = (key) => {
    const t = THEME[key]; const n = report[key].length;
    return {
      type: 'box', layout: 'vertical', flex: 1, cornerRadius: '14px', paddingAll: '12px', background: n ? grad(t.c1, t.c2) : grad('#CFD8DC', '#B0BEC5'),
      contents: [
        { type: 'text', text: String(n), size: '3xl', weight: 'bold', color: '#FFFFFF', align: 'center' },
        { type: 'text', text: t.label, size: 'xs', color: '#FFFFFF', align: 'center', weight: 'bold', wrap: true },
      ],
    };
  };
  const total = ['emergency', 'belowMin', 'zeroFloor', 'belowSubPar', 'expiring'].reduce((a, k) => a + report[k].length, 0);
  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', paddingAll: '16px', background: grad('#02B0AE', '#004C4B'), contents: [
      { type: 'text', text: 'สต็อกยา · ห้องยา', color: '#B2F0EE', size: 'xs', weight: 'bold' },
      { type: 'text', text: 'แจ้งเตือนประจำวัน', color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'xs' },
      { type: 'text', text: dateLabel, color: '#E1F7F6', size: 'xs', wrap: true, margin: 'xs' },
    ] },
    body: { type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'md', contents: [
      { type: 'text', text: `พบ ${total} รายการที่ควรดำเนินการ`, size: 'sm', weight: 'bold', color: '#12211A' },
      ...(report.emergency.length ? [{ type: 'box', layout: 'horizontal', contents: [tile('emergency')] }, {
        type: 'text', size: 'xs', weight: 'bold', wrap: true, color: '#B71C1C',
        text: [1, 2, 3].map((n) => { const c = report.emergency.filter((e) => e.level.n === n).length; return c ? urgencyLevel(n === 1 ? 0 : n === 2 ? 3 : 7).dot + urgencyLevel(n === 1 ? 0 : n === 2 ? 3 : 7).label + ' ' + c : ''; }).filter(Boolean).join('  ·  '),
      }] : []),
      { type: 'box', layout: 'horizontal', spacing: 'md', contents: [tile('belowMin'), tile('zeroFloor')] },
      { type: 'box', layout: 'horizontal', spacing: 'md', contents: [tile('belowSubPar'), tile('expiring')] },
      { type: 'text', text: 'ปัดการ์ดไปทางซ้ายเพื่อดูรายชื่อยาในแต่ละหมวด', size: 'xxs', color: '#8A918B', wrap: true },
    ] },
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'button', style: 'primary', color: '#007371', height: 'sm', action: { type: 'uri', label: 'เปิดแอปสต็อกยา', uri: APP_URL } },
    ] },
  };
}

function rowFlex(sec, key, r) {
  const t = THEME[key];
  const hasBar = key === 'belowMin' || key === 'belowSubPar';
  const pct = hasBar && r.ref > 0 ? Math.max(3, Math.min(100, Math.round((r.cur / r.ref) * 100))) : 0;
  const urgentExp = (key === 'expiring' && r.days <= 7) || (key === 'emergency' && r.cover <= 7);
  const valueColor = key === 'emergency' ? r.level.ink : urgentExp ? '#C62828' : t.ink;
  const inner = [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: r.name, size: 'sm', weight: 'bold', wrap: true, flex: 5, color: '#12211A' },
      ...(key === 'expiring' ? [] : [{ type: 'text', text: sec.valueText(r), size: 'sm', weight: 'bold', color: valueColor, align: 'end', flex: 3, wrap: true }]),
    ] },
  ];
  if (key === 'expiring') inner.push({ type: 'text', text: sec.fmt(r), size: 'xs', weight: 'bold', color: valueColor, wrap: true });
  else if (key === 'emergency') inner.push({ type: 'text', text: `คงเหลือ ${nf(r.onHand)} ${r.unit} · ควรขอ ~${nf(r.needQty)} ${r.unit}`, size: 'xs', color: '#666666', wrap: true });
  else if (key === 'zeroFloor') inner.push({ type: 'text', text: 'ยังไม่ได้นับวันนี้ — นับจริงแล้วบันทึกในแอป', size: 'xxs', color: '#8A918B', wrap: true });
  if (hasBar) inner.push({ type: 'box', layout: 'horizontal', height: '6px', margin: 'sm', backgroundColor: '#E6E9E4', cornerRadius: '3px', contents: [
    { type: 'box', layout: 'vertical', width: pct + '%', backgroundColor: t.c2, cornerRadius: '3px', contents: [{ type: 'filler' }] },
  ] });
  const rowBg = key === 'emergency' ? r.level.bg : t.soft;
  return { type: 'box', layout: 'vertical', margin: 'md', paddingAll: '10px', backgroundColor: rowBg, cornerRadius: '10px', contents: inner };
}

function sectionBubble(sec, report) {
  const key = sec.key; const t = THEME[key]; const rows = report[key];
  const shown = rows.slice(0, ROWS_PER_CARD);
  const body = shown.map((r) => rowFlex(sec, key, r));
  if (rows.length > shown.length) body.push({ type: 'text', text: `…และอีก ${rows.length - shown.length} รายการ — ดูทั้งหมดในแอป`, size: 'xs', color: '#8A918B', margin: 'md', wrap: true });
  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'horizontal', paddingAll: '14px', background: grad(t.c1, t.c2), contents: [
      { type: 'text', text: sec.icon, size: 'xxl', flex: 0, gravity: 'center' },
      { type: 'box', layout: 'vertical', margin: 'md', flex: 1, contents: [
        { type: 'text', text: `${t.label} · ${rows.length} รายการ`, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: key === 'expiring' ? `ภายใน ${report.expiryWarnDays} วัน · ${t.sub}` : key === 'emergency' ? `เหลือใช้ไม่เกิน ${report.horizonDays} วัน · เรียงตามความเร่งด่วน` : t.sub, color: '#FFFFFFD9', size: 'xs', wrap: true },
      ] },
    ] },
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: body },
  };
}

/** Flex carousel for MOPH Notify: summary card + one coloured card per non-empty alert type. */
export function buildFlex(report, dateLabel) {
  const bubbles = [summaryBubble(report, dateLabel)];
  for (const sec of SECTIONS) if (report[sec.key].length) bubbles.push(sectionBubble(sec, report));
  const counts = SECTIONS.map((s) => report[s.key].length ? `${s.icon}${report[s.key].length}` : '').filter(Boolean).join(' ');
  return {
    type: 'flex',
    altText: `แจ้งเตือนสต็อกยา ${dateLabel} ${counts}`.slice(0, 400),
    contents: { type: 'carousel', contents: bubbles },
  };
}

export async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const mophKey = process.env.MOPH_NOTIFY_CLIENT_KEY;
  const mophSecret = process.env.MOPH_NOTIFY_SECRET_KEY;
  const hasMoph = !!(mophKey && mophSecret);
  if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
  if (!dryRun && !lineToken && !hasMoph) { console.error('Set LINE_CHANNEL_ACCESS_TOKEN and/or MOPH_NOTIFY_CLIENT_KEY + MOPH_NOTIFY_SECRET_KEY (or pass --dry-run to test without them).'); process.exit(1); }

  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();

  // Only lots with qty > 0 are read (server-side filter) — `lots` never deletes spent lots, so an unfiltered read grows forever.
  console.log('Reading meds/lots/settings...');
  const [medSnap, lotSnap, settingsSnap] = await Promise.all([
    db.collection('meds').get(),
    db.collection('lots').where('qty', '>', 0).get(),
    db.doc('meta/settings').get().catch(() => null),
  ]);
  const meds = medSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lots = lotSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const settings = settingsSnap && typeof settingsSnap.data === 'function' ? (settingsSnap.data() || {}) : {};
  const expiryWarnDays = typeof settings.expiryWarnDays === 'number' ? settings.expiryWarnDays : 30;

  // Days until the next regular warehouse delivery: NEXT_DELIVERY_DATE (YYYY-MM-DD, set as a repo variable) when given and in the
  // future, else REQ_HORIZON_DAYS, else 7.
  let horizonDays = Number(process.env.REQ_HORIZON_DAYS) > 0 ? Number(process.env.REQ_HORIZON_DAYS) : 7;
  const nd = process.env.NEXT_DELIVERY_DATE;
  if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) {
    const diff = Math.ceil((Date.parse(nd + 'T00:00:00+07:00') - Date.now()) / DAY_MS);
    if (diff > 0) horizonDays = diff;
  }
  const report = buildReport({ meds, lots, expiryWarnDays, horizonDays });
  if (report.empty) {
    console.log('Nothing below par today — skipping notification (no alert fatigue for a clean day).');
    return;
  }
  const dateLabel = dateLabelBkk();
  const text = buildText(report, dateLabel);
  console.log('--- message ---\n' + text + '\n---------------');
  if (dryRun) { console.log('(--dry-run — not sending)'); return; }

  // Send to every configured channel; one failing must not stop the other, but the run still fails so it is noticed.
  const failures = [];
  if (hasMoph) {
    try {
      await mophNotify(mophKey, mophSecret, [buildFlex(report, dateLabel)]);
      console.log('MOPH Notify: sent to LINE group.');
    } catch (e) { failures.push(e); console.error(String(e.message || e)); }
  }
  if (lineToken) { try { await lineBroadcast(lineToken, text); console.log('LINE OA broadcast: sent.'); } catch (e) { failures.push(e); console.error(String(e.message || e)); } }
  if (failures.length) throw new Error(`${failures.length} notification channel(s) failed: ` + failures.map((e) => e.message).join(' | '));
  console.log(`Sent — Min ${report.belowMin.length}, par ${report.belowSubPar.length}, zero ${report.zeroFloor.length}, expiring ${report.expiring.length}.`);
}

// Only auto-run when this file is actually run as a script — NOT when it's imported (tests drive `main` with mocks).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Low-stock notify failed:', err);
    process.exit(1);
  });
}
