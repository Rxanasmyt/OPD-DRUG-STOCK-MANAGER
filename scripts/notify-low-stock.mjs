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
export function buildReport({ meds, lots, expiryWarnDays = 30, now = Date.now() }) {
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
  const belowSubPar = active.filter((m) => !isOnStockHold(m) && (usesSubstock(m) ? subQty(m.id) < (m.parSub || 0) : (m.floor || 0) < (m.parFloor || 0)))
    .map((m) => usesSubstock(m)
      ? { name: m.name, unit: m.unit, cur: subQty(m.id), ref: m.parSub || 0 }
      : { name: m.name, unit: m.unit, cur: m.floor || 0, ref: m.parFloor || 0 });
  const zeroFloor = active.filter((m) => needsZeroFloorCheck(m, now)).map((m) => ({ name: m.name, unit: m.unit }));
  // A zero-floor med is always below Min too; list it once (under "ยอด 0 ควรนับจริง", the action it actually needs) instead of
  // repeating it in two sections of the same message.
  const zeroNames = new Set(zeroFloor.map((z) => z.name));
  const belowMinShown = belowMin.filter((r) => !zeroNames.has(r.name));
  return { belowMin: belowMinShown, belowSubPar, zeroFloor, expiring, expiryWarnDays, empty: !belowMinShown.length && !belowSubPar.length && !zeroFloor.length && !expiring.length };
}

const SECTIONS = [
  { key: 'belowMin', icon: '🔴', color: '#C62828', title: 'ต่ำกว่าจุดต้องเติม (Min) — ควรเติมวันนี้', fmt: (r) => `${nf(r.cur)}/${nf(r.ref)} ${r.unit}` },
  { key: 'zeroFloor', icon: '0️⃣', color: '#6A1B9A', title: 'ยอดหน้างานเป็น 0 — ควรนับจริง', fmt: () => 'ยังไม่ได้นับวันนี้' },
  { key: 'belowSubPar', icon: '🟡', color: '#B26A00', title: 'ต่ำกว่า par — ควรเบิกจากคลังใหญ่', fmt: (r) => `${nf(r.cur)}/${nf(r.ref)} ${r.unit}` },
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

/** Flex message (card) for MOPH Notify. */
export function buildFlex(report, dateLabel) {
  const body = [];
  for (const sec of SECTIONS) {
    const rows = report[sec.key];
    if (!rows.length) continue;
    const shown = rows.slice(0, 8);
    body.push({ type: 'text', text: `${sec.icon} ${sec.title} (${rows.length})`, weight: 'bold', size: 'sm', color: sec.color, wrap: true, margin: body.length ? 'lg' : 'none' });
    for (const r of shown) {
      body.push({
        type: 'box', layout: 'vertical', margin: 'sm', contents: [
          { type: 'text', text: r.name, size: 'sm', wrap: true, weight: 'bold' },
          { type: 'text', text: sec.fmt(r), size: 'xs', color: '#666666', wrap: true },
        ],
      });
    }
    if (rows.length > shown.length) body.push({ type: 'text', text: `…และอีก ${rows.length - shown.length} รายการ (ดูในแอพ)`, size: 'xs', color: '#888888', margin: 'sm' });
  }
  const counts = SECTIONS.map((s) => report[s.key].length ? `${s.icon}${report[s.key].length}` : '').filter(Boolean).join(' ');
  return {
    type: 'flex',
    altText: `แจ้งเตือนสต็อกยา ${dateLabel} ${counts}`.slice(0, 400),
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#007371', paddingAll: '14px', contents: [
        { type: 'text', text: 'แจ้งเตือนสต็อกยา', color: '#FFFFFF', weight: 'bold', size: 'lg' },
        { type: 'text', text: 'ห้องยา รพ.กรงปินัง · ' + dateLabel, color: '#E1F7F6', size: 'xs', wrap: true, margin: 'xs' },
      ] },
      body: { type: 'box', layout: 'vertical', contents: body },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#007371', height: 'sm', action: { type: 'uri', label: 'เปิดแอปสต็อกยา', uri: APP_URL } },
      ] },
    },
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

  const report = buildReport({ meds, lots, expiryWarnDays });
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
