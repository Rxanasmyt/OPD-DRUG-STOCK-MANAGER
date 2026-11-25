#!/usr/bin/env node
// Monthly returns (คืนยา) report to the LINE group (MOPH Notify) — runs on the 1st of each month and reports the month that just
// ended, with the previous months for context, so the numbers can be shown to the head of the department.
// The Flex carousel is a set of "views" you swipe through: ภาพรวม · แนวโน้ม 6 เดือน · แยกตามหมวดหมู่ยา · แยกตามเหตุผลการคืน · ยาคืนมูลค่าสูงสุด.
// Every card has a button that opens the app's ↩️ รายงานคืนยา at that month and view (?r=returns&m=YYYY-MM&v=all|cat|reason).
// Grouping/netting logic is a copy of src/utils/returnsSummary.ts + returnReasons.ts — parity is checked in notify-monthly-returns.test.mjs.
//   FIREBASE_SERVICE_ACCOUNT_KEY=... MOPH_NOTIFY_CLIENT_KEY=... MOPH_NOTIFY_SECRET_KEY=... node scripts/notify-monthly-returns.mjs [--dry-run] [--month=2026-10]
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { APP_URL, sendIfConfigured } from './moph-notify.mjs';

// ---- copies of the app's constants (src/utils/returnReasons.ts, src/data/categories.ts) --------------------------------------
export const REVERSAL_PREFIX = '↩ ยกเลิกรายการคืน · ';
const RETURN_REASON_GROUPS = [
  { key: 'treat', icon: '🩺', label: 'การรักษา', reasons: ['ปรับเปลี่ยนการรักษา', 'แพ้ยา/ผลข้างเคียงการรักษา', 'แพทย์สั่งหยุดยา', 'อาการดีขึ้น/หายแล้ว'] },
  { key: 'patient', icon: '👤', label: 'ผู้ป่วย', reasons: ['Non-compliance', 'ไม่ประสงค์รับยา', 'ผู้ป่วยเสียชีวิต', 'ย้ายสถานพยาบาล/จำหน่ายผู้ป่วย'] },
  { key: 'qty', icon: '📦', label: 'ปริมาณยาเหลือ', reasons: ['ได้ยาเกินจากวันนัดรอบก่อน', 'ยาตามอาการเหลือ', 'ยาโรคเรื้อรังเหลือเยอะ'] },
  { key: 'error', icon: '⚠️', label: 'ความคลาดเคลื่อน', reasons: ['จ่ายยาผิดตัว/ผิดความแรง', 'จ่ายยาเกิน/ผิดจำนวน', 'ยกเลิกใบสั่งยา (ยังไม่ได้ส่งมอบ)'] },
  { key: 'unit', icon: '🏥', label: 'หน่วยงาน', reasons: ['ยาเหลือจากหน่วยงาน/ตึกผู้ป่วย', 'ยาตู้ฉุกเฉิน/รถ Refer ไม่ได้ใช้'] },
];
export const CATEGORY_LABELS = {
  pain: 'ยาแก้ปวด/ลดไข้/ต้านอักเสบ (NSAID)', steroid: 'ยาสเตียรอยด์/คอร์ติโคสเตียรอยด์', antimicrobial: 'ยาต้านจุลชีพ (ปฏิชีวนะ/เชื้อรา/ไวรัส)',
  oncology: 'ยามะเร็ง/เคมีบำบัด/กดภูมิคุ้มกัน', cardio: 'ยาโรคหัวใจ/หลอดเลือด/ความดัน', endocrine: 'ยาเบาหวาน/ต่อมไร้ท่อ/ไขมันในเลือด',
  hormone_repro: 'ฮอร์โมน/คุมกำเนิด/สูติศาสตร์', resp: 'ยาระบบทางเดินหายใจ/หอบหืด', gi: 'ยาระบบทางเดินอาหาร', neuro_psych: 'ยาระบบประสาท/จิตเวช/นอนไม่หลับ',
  anesthetic: 'ยาชา/ยาคลายกล้ามเนื้อ', allergy: 'ยาแก้แพ้/ภูมิแพ้', derm: 'ยาผิวหนัง/ยาทาภายนอก', eye_ent: 'ยาตา/หู/คอ/จมูก',
  vitamin: 'วิตามิน/เกลือแร่/อาหารเสริม', iv_fluid: 'สารน้ำ/IV fluid', emergency: 'ยาฉุกเฉิน/ช่วยชีวิต', vaccine_biologic: 'วัคซีน/เซรุ่ม/อิมมูโนโกลบูลิน',
  herbal: 'ยาสมุนไพร/แผนไทย', supply: 'เวชภัณฑ์ที่ไม่ใช่ยา', other: 'อื่นๆ / ยังไม่ระบุหมวด',
};
const categoryLabel = (id) => (id && CATEGORY_LABELS[id]) || CATEGORY_LABELS.other;
const UNKNOWN_REASON = 'ไม่ระบุเหตุผล (รายการเก่า)';
const OTHER_REASON = 'อื่น ๆ (ระบุเอง)';
const GROUP_OF_REASON = new Map(RETURN_REASON_GROUPS.flatMap((g) => g.reasons.map((x) => [x, g])));

const isReversal = (reason) => !!reason && reason.startsWith(REVERSAL_PREFIX);
const baseReason = (r) => { const x = r.reason ?? ''; return isReversal(x) ? x.slice(REVERSAL_PREFIX.length) : x; };
const reasonGroupOf = (reason) => !reason ? { key: 'unknown', icon: '❔', label: UNKNOWN_REASON } : (GROUP_OF_REASON.get(reason) ?? { key: 'other', icon: '📝', label: OTHER_REASON });
const reversalTargetId = (note) => { const m = /^#([A-Za-z0-9]+)\b/.exec(note ?? ''); return m ? m[1] : null; };

/** Net rows (reversal = negative) and live originals (not cancelled, not a reversal row). */
export function netAndLive(records) {
  const cancelled = new Set();
  for (const r of records) if (isReversal(r.reason)) { const id = reversalTargetId(r.note); if (id) cancelled.add(id); }
  const net = records.map((r) => (isReversal(r.reason) ? { ...r, qty: -Math.abs(r.qty), value: -Math.abs(r.value) } : r));
  const live = records.filter((r) => !isReversal(r.reason) && !(r.id && cancelled.has(r.id)));
  return { net, live };
}

export function groupReturns(records, by) {
  const { net, live } = netAndLive(records);
  const map = new Map();
  const keyOf = (r) => by === 'cat' ? { key: r.category || 'other', label: categoryLabel(r.category), icon: undefined } : (() => { const g = reasonGroupOf(baseReason(r)); return { key: g.key, label: g.label, icon: g.icon }; })();
  const get = (r) => {
    const k = keyOf(r);
    let g = map.get(k.key);
    if (!g) { g = { key: k.key, label: k.label, icon: k.icon, count: 0, qty: 0, value: 0, children: by === 'reason' ? [] : undefined }; map.set(k.key, g); }
    return g;
  };
  const childLabel = (r) => { const b = baseReason(r); return b ? (GROUP_OF_REASON.has(b) ? b : 'อื่น ๆ: ' + b) : UNKNOWN_REASON; };
  const child = (g, label) => { let c = g.children.find((x) => x.label === label); if (!c) { c = { label, count: 0, value: 0 }; g.children.push(c); } return c; };
  for (const r of net) { const g = get(r); g.qty += r.qty; g.value += Math.round(r.value); if (g.children) child(g, childLabel(r)).value += Math.round(r.value); }
  for (const r of live) { const g = get(r); g.count++; if (g.children) child(g, childLabel(r)).count++; }
  const out = [...map.values()];
  for (const g of out) g.children?.sort((a, b) => b.value - a.value);
  return out.sort((a, b) => b.value - a.value || b.count - a.count);
}

// ---- months ---------------------------------------------------------------------------------------------------------------------
const BKK = 7 * 3600000;
export const monthOf = (ms) => new Date(ms + BKK).toISOString().slice(0, 7);
export function shiftMonth(ym, delta) { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return d.toISOString().slice(0, 7); }
export const previousMonthOf = (ms) => shiftMonth(monthOf(ms), -1);
export function monthRange(ym) { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }; }
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${TH_MONTHS[m - 1]} ${y + 543}`; };
export const monthShort = (ym) => { const [y, m] = ym.split('-').map(Number); return `${TH_SHORT[m - 1]} ${String(y + 543).slice(2)}`; };

const nf = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');

/** Pure: everything the report says. `records` = all returns rows from the first month of the window through the report month. */
export function buildMonthlyReport({ records, month, monthsBack = 6 }) {
  const months = Array.from({ length: monthsBack }, (_, i) => shiftMonth(month, i - (monthsBack - 1)));
  const byMonth = new Map(months.map((m) => [m, []]));
  for (const r of records) { const m = (r.date || '').slice(0, 7); if (byMonth.has(m)) byMonth.get(m).push(r); }
  const trend = months.map((m) => {
    const rs = byMonth.get(m); const { net, live } = netAndLive(rs);
    return { month: m, count: live.length, value: net.reduce((s, r) => s + Math.round(r.value), 0), qty: net.reduce((s, r) => s + r.qty, 0) };
  });
  const cur = byMonth.get(month); const { live } = netAndLive(cur);
  const t = trend[trend.length - 1]; const prev = trend[trend.length - 2];
  const topMeds = (() => {
    const { net } = netAndLive(cur); const m = new Map();
    for (const r of net) { const e = m.get(r.medId) || { name: r.medName, unit: r.unit, value: 0, qty: 0 }; e.value += Math.round(r.value); e.qty += r.qty; m.set(r.medId, e); }
    return [...m.values()].filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
  })();
  return {
    month, trend,
    total: { count: t.count, value: t.value, qty: t.qty, hn: new Set(live.map((r) => r.hn)).size },
    prev: prev ? { count: prev.count, value: prev.value } : null,
    byCategory: groupReturns(cur, 'cat'), byReason: groupReturns(cur, 'reason'), topMeds,
    empty: cur.length === 0,
  };
}

// ---- Flex -------------------------------------------------------------------------------------------------------------------------
const grad = (c1, c2) => ({ type: 'linearGradient', angle: '135deg', startColor: c1, endColor: c2 });
const link = (month, v) => `${APP_URL}?r=returns&m=${month}&v=${v}`;
const footerBtn = (label, uri, color) => ({ type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color, height: 'sm', action: { type: 'uri', label, uri } }] });
const header = (icon, title, sub, c1, c2) => ({ type: 'box', layout: 'horizontal', paddingAll: '14px', background: grad(c1, c2), contents: [
  { type: 'text', text: icon, size: 'xxl', flex: 0, gravity: 'center' },
  { type: 'box', layout: 'vertical', margin: 'md', flex: 1, contents: [
    { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true },
    { type: 'text', text: sub, color: '#FFFFFFD9', size: 'xs', wrap: true },
  ] },
] });
const bar = (pct, color) => ({ type: 'box', layout: 'horizontal', height: '6px', margin: 'sm', backgroundColor: '#E6E9E4', cornerRadius: '3px', contents: [
  { type: 'box', layout: 'vertical', width: Math.max(3, Math.min(100, Math.round(pct))) + '%', backgroundColor: color, cornerRadius: '3px', contents: [{ type: 'filler' }] },
] });
const statTile = (label, value, c1, c2) => ({ type: 'box', layout: 'vertical', flex: 1, cornerRadius: '12px', paddingAll: '10px', background: grad(c1, c2), contents: [
  { type: 'text', text: value, size: 'xl', weight: 'bold', color: '#FFFFFF', align: 'center', adjustMode: 'shrink-to-fit' },
  { type: 'text', text: label, size: 'xxs', color: '#FFFFFF', align: 'center', weight: 'bold', wrap: true },
] });
const deltaText = (cur, prev) => {
  if (!prev || !(prev.value > 0)) return 'เดือนก่อนไม่มีข้อมูลเทียบ';
  const d = ((cur - prev.value) / prev.value) * 100;
  return `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}% จากเดือนก่อน (${nf(prev.value)} บาท)`;
};

function summaryCard(rep) {
  const { total, prev } = rep;
  const up = prev && total.value > prev.value;
  const topCat = rep.byCategory[0]; const topReason = rep.byReason[0];
  return { type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', paddingAll: '16px', background: grad('#02B0AE', '#004C4B'), contents: [
      { type: 'text', text: 'รายงานคืนยารายเดือน', color: '#B2F0EE', size: 'xs', weight: 'bold' },
      { type: 'text', text: monthLabel(rep.month), color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'xs' },
      { type: 'text', text: 'ห้องยา รพ.กรงปินัง · ภาพรวมเดือนที่ผ่านมา', color: '#E1F7F6', size: 'xs', margin: 'xs', wrap: true },
    ] },
    body: { type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'md', contents: rep.empty ? [
      { type: 'text', text: 'เดือนนี้ไม่มีการบันทึกคืนยา', size: 'sm', weight: 'bold', color: '#12211A', wrap: true },
      { type: 'text', text: 'ถ้าคิดว่าควรมี ให้ตรวจว่ามีการบันทึก “คืนยา” ในหน้าปรับยอดครบหรือไม่', size: 'xs', color: '#6D736D', wrap: true },
    ] : [
      { type: 'text', text: `${nf(total.value)} บาท`, size: '3xl', weight: 'bold', color: '#007371', adjustMode: 'shrink-to-fit' },
      { type: 'text', text: deltaText(total.value, prev), size: 'xs', weight: 'bold', wrap: true, color: prev && prev.value > 0 ? (up ? '#C62828' : '#2E7D32') : '#8A918B' },
      { type: 'box', layout: 'horizontal', spacing: 'md', contents: [statTile('ครั้งที่คืน', nf(total.count), '#02B0AE', '#007371'), statTile('ผู้ป่วย (HN)', nf(total.hn), '#7C4DFF', '#4527A0')] },
      ...(topCat ? [{ type: 'text', text: `🗂 หมวดมูลค่าสูงสุด: ${topCat.label} (${nf(topCat.value)} บาท)`, size: 'xs', wrap: true, color: '#12211A' }] : []),
      ...(topReason ? [{ type: 'text', text: `💬 เหตุผลหลัก: ${topReason.icon ?? ''} ${topReason.label} (${nf(topReason.value)} บาท)`, size: 'xs', wrap: true, color: '#12211A' }] : []),
      { type: 'text', text: 'ปัดการ์ดไปทางซ้ายเพื่อดู: แนวโน้ม · แยกตามหมวดหมู่ยา · แยกตามเหตุผล · ยาคืนสูงสุด', size: 'xxs', color: '#8A918B', wrap: true },
    ] },
    footer: footerBtn('ดูทุกหมวด (รายการทั้งหมด)', link(rep.month, 'all'), '#007371') };
}

function trendCard(rep) {
  const max = Math.max(1, ...rep.trend.map((t) => t.value));
  return { type: 'bubble', size: 'mega',
    header: header('📈', 'แนวโน้ม 6 เดือน', 'มูลค่ายาที่คืนในแต่ละเดือน', '#7C4DFF', '#4527A0'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'sm', contents: rep.trend.map((t) => {
      const cur = t.month === rep.month;
      return { type: 'box', layout: 'vertical', margin: 'sm', contents: [
        { type: 'box', layout: 'horizontal', contents: [
          { type: 'text', text: monthShort(t.month), size: 'xs', weight: cur ? 'bold' : 'regular', color: cur ? '#4527A0' : '#555555', flex: 3 },
          { type: 'text', text: `${nf(t.value)} บาท · ${nf(t.count)} ครั้ง`, size: 'xs', weight: cur ? 'bold' : 'regular', color: cur ? '#4527A0' : '#555555', align: 'end', flex: 7 },
        ] },
        bar((t.value / max) * 100, cur ? '#4527A0' : '#B39DDB'),
      ] };
    }) },
    footer: footerBtn('เปิดรายงานในแอป', link(rep.month, 'all'), '#4527A0') };
}

function groupsCard(rep, by) {
  const groups = by === 'cat' ? rep.byCategory : rep.byReason;
  const shown = groups.slice(0, 7);
  const rest = groups.slice(7);
  const total = Math.max(1, groups.reduce((s, g) => s + Math.max(0, g.value), 0));
  const rows = shown.map((g, i) => ({ type: 'box', layout: 'vertical', margin: 'md', contents: [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: `${g.icon ? g.icon + ' ' : ''}${g.label}`, size: 'sm', weight: 'bold', wrap: true, flex: 6, color: '#12211A' },
      { type: 'text', text: `${nf(g.value)}`, size: 'sm', weight: 'bold', align: 'end', flex: 3, color: by === 'cat' ? '#007371' : '#BF360C' },
    ] },
    { type: 'text', text: `${nf(g.count)} ครั้ง · ${Math.round((Math.max(0, g.value) / total) * 100)}% ของมูลค่า` + (by === 'reason' && g.children?.[0] ? ` · มาก: ${g.children[0].label}` : ''), size: 'xxs', color: '#6D736D', wrap: true },
    bar((Math.max(0, g.value) / total) * 100, by === 'cat' ? '#02B0AE' : '#FF7043'),
  ] }));
  if (rest.length) rows.push({ type: 'text', text: `…และอีก ${rest.length} กลุ่ม (${nf(rest.reduce((s, g) => s + g.value, 0))} บาท) — ดูในแอป`, size: 'xs', color: '#8A918B', margin: 'md', wrap: true });
  if (!groups.length) rows.push({ type: 'text', text: 'ไม่มีข้อมูล', size: 'sm', color: '#8A918B' });
  return { type: 'bubble', size: 'mega',
    header: by === 'cat' ? header('🗂', 'แยกตามหมวดหมู่ยา', `${monthLabel(rep.month)} · มูลค่า (บาท)`, '#02B0AE', '#004C4B') : header('💬', 'แยกตามเหตุผลการคืนยา', `${monthLabel(rep.month)} · มูลค่า (บาท)`, '#FF8A65', '#BF360C'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: rows },
    footer: footerBtn(by === 'cat' ? 'ดูแยกตามหมวดหมู่ในแอป' : 'ดูแยกตามเหตุผลในแอป', link(rep.month, by), by === 'cat' ? '#007371' : '#BF360C') };
}

function topMedsCard(rep) {
  return { type: 'bubble', size: 'mega',
    header: header('💊', 'ยาคืนมูลค่าสูงสุด', `${monthLabel(rep.month)} · 5 อันดับ`, '#FFB300', '#E65100'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: rep.topMeds.length ? rep.topMeds.map((m, i) => ({ type: 'box', layout: 'horizontal', margin: 'md', contents: [
      { type: 'text', text: String(i + 1), size: 'lg', weight: 'bold', color: '#E65100', flex: 0, gravity: 'center' },
      { type: 'box', layout: 'vertical', margin: 'md', flex: 1, contents: [
        { type: 'text', text: m.name, size: 'sm', weight: 'bold', wrap: true, color: '#12211A' },
        { type: 'text', text: `${nf(m.qty)} ${m.unit}`, size: 'xxs', color: '#6D736D' },
      ] },
      { type: 'text', text: `${nf(m.value)}`, size: 'sm', weight: 'bold', color: '#E65100', align: 'end', flex: 0, gravity: 'center' },
    ] })) : [{ type: 'text', text: 'ไม่มีข้อมูล', size: 'sm', color: '#8A918B' }] },
    footer: footerBtn('ดูรายการทั้งหมดในแอป', link(rep.month, 'all'), '#E65100') };
}

export function buildMonthlyFlex(rep) {
  const bubbles = [summaryCard(rep)];
  if (!rep.empty) bubbles.push(trendCard(rep), groupsCard(rep, 'cat'), groupsCard(rep, 'reason'), topMedsCard(rep));
  return { type: 'flex', altText: `รายงานคืนยา ${monthLabel(rep.month)} — ${nf(rep.total.value)} บาท · ${nf(rep.total.count)} ครั้ง`.slice(0, 400), contents: { type: 'carousel', contents: bubbles } };
}

// ---- main ---------------------------------------------------------------------------------------------------------------------------
export async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const arg = process.argv.find((a) => a.startsWith('--month='));
  const month = arg ? arg.slice(8) : (process.env.REPORT_MONTH || previousMonthOf(Date.now()));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { console.error('Bad month (expected YYYY-MM): ' + month); process.exit(1); }
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();
  const from = monthRange(shiftMonth(month, -5)).from; const to = monthRange(month).to;
  // `date` is a single-field range (+ orderBy on the same field) — no composite index. ~6 months of returns, once a month.
  const snap = await db.collection('returns').where('date', '>=', from).where('date', '<=', to).orderBy('date', 'asc').get();
  const records = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  console.log(`Returns ${from}..${to}: ${records.length} rows`);
  const rep = buildMonthlyReport({ records, month });
  console.log(`${monthLabel(month)}: ${rep.total.count} returns, ${rep.total.value} baht`);
  const flex = buildMonthlyFlex(rep);
  if (dryRun) { console.log(JSON.stringify(flex.contents.contents.length) + ' cards, ' + JSON.stringify(flex).length + ' bytes (--dry-run — not sending)'); return; }
  await sendIfConfigured([flex]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('Monthly returns report failed:', err); process.exit(1); });
}
