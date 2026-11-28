#!/usr/bin/env node
// Monthly returns (คืนยา) report to the LINE group (MOPH Notify) — runs on the 1st of each month and reports the month that just
// ended, with the previous months for context, so the numbers can be shown to the head of the department.
// The Flex carousel is a set of "views" you swipe through: ภาพรวม · แนวโน้ม 6 เดือน · แยกตามหมวดหมู่ยา · แยกตามเหตุผลการคืน · ยาคืนมูลค่าสูงสุด.
// Every card has a button that opens the app's ↩️ รายงานคืนยา at that month and view (?r=returns&m=YYYY-MM&v=all|cat|reason).
// Grouping/netting logic is a copy of src/utils/returnsSummary.ts + returnReasons.ts — parity is checked in notify-monthly-returns.test.mjs.
//   FIREBASE_SERVICE_ACCOUNT_KEY=... MOPH_NOTIFY_CLIENT_KEY=... MOPH_NOTIFY_SECRET_KEY=... node scripts/notify-monthly-returns.mjs [--dry-run] [--month=2026-10]
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { APP_URL, sendIfConfigured, waitUntilBangkokTime, stampRun } from './moph-notify.mjs';

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

/** Direction of the monthly value series: least-squares slope relative to the average (±5%/month is "flat"). Pure; exported for tests. */
export function analyzeTrend(trend) {
  const ys = trend.map((t) => t.value); const n = ys.length;
  const avg = n ? ys.reduce((a, b) => a + b, 0) / n : 0;
  const xm = (n - 1) / 2;
  const sxx = ys.reduce((a, _, i) => a + (i - xm) ** 2, 0) || 1;
  const slope = ys.reduce((a, y, i) => a + (i - xm) * (y - avg), 0) / sxx; // baht per month
  const rel = avg > 0 ? slope / avg : 0;
  const dir = rel > 0.05 ? 'up' : rel < -0.05 ? 'down' : 'flat';
  let peak = 0; ys.forEach((y, i) => { if (y > ys[peak]) peak = i; });
  return { avg: Math.round(avg), slope: Math.round(slope), rel, dir, peakMonth: trend[peak]?.month ?? null, peakValue: ys[peak] ?? 0 };
}

/** Pure: everything the report says. `records` = returns rows for the report month and up to 12 months before it (13-month window: the
 * 6-month trend, the previous month, and the same month last year for the year-on-year comparison). */
export const ADR_REASON = 'แพ้ยา/ผลข้างเคียงการรักษา';
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const dowOf = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
const daysIn = (ym) => Number(monthRange(ym).to.slice(8, 10));

export function buildMonthlyReport({ records, month, monthsBack = 13 }) {
  const months = Array.from({ length: monthsBack }, (_, i) => shiftMonth(month, i - (monthsBack - 1)));
  const byMonth = new Map(months.map((m) => [m, []]));
  for (const r of records) { const m = (r.date || '').slice(0, 7); if (byMonth.has(m)) byMonth.get(m).push(r); }
  const stat = (m) => {
    const rs = byMonth.get(m); const { net, live } = netAndLive(rs);
    return { month: m, count: live.length, value: net.reduce((s, r) => s + Math.round(r.value), 0), qty: net.reduce((s, r) => s + r.qty, 0) };
  };
  const all = months.map(stat);
  const trend = all.slice(-6);
  const cur = byMonth.get(month); const { net: curNet, live } = netAndLive(cur);
  const t = trend[trend.length - 1]; const prev = trend[trend.length - 2];
  const yoyRaw = months.length >= 13 ? all[0] : null;
  const yoy = yoyRaw && (yoyRaw.count > 0 || yoyRaw.value !== 0) ? { month: yoyRaw.month, count: yoyRaw.count, value: yoyRaw.value } : null;

  const topMeds = (() => {
    const m = new Map();
    for (const r of curNet) { const e = m.get(r.medId) || { name: r.medName, unit: r.unit, value: 0, qty: 0 }; e.value += Math.round(r.value); e.qty += r.qty; m.set(r.medId, e); }
    return [...m.values()].filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
  })();

  // by day of the month (value, count) and by weekday (count)
  const nDays = daysIn(month);
  const daily = Array.from({ length: nDays }, (_, i) => ({ day: i + 1, count: 0, value: 0 }));
  for (const r of curNet) { const d = Number((r.date || '').slice(8, 10)); if (daily[d - 1]) daily[d - 1].value += Math.round(r.value); }
  for (const r of live) { const d = Number((r.date || '').slice(8, 10)); if (daily[d - 1]) daily[d - 1].count++; }
  const weekday = WEEKDAYS.map((label, i) => ({ label, count: 0, value: 0, i }));
  for (const r of live) weekday[dowOf(r.date)].count++;
  for (const r of curNet) weekday[dowOf(r.date)].value += Math.round(r.value);
  const peakDay = daily.reduce((b, d) => (d.value > b.value ? d : b), { day: 0, count: 0, value: 0 });

  // categories: this month vs previous month (value) + the biggest drug in each
  const byCategory = groupReturns(cur, 'cat');
  const prevCat = new Map(groupReturns(byMonth.get(shiftMonth(month, -1)), 'cat').map((g) => [g.key, g.value]));
  const catTop = new Map();
  for (const r of curNet) { const k = r.category || 'other'; const m = catTop.get(k) || new Map(); m.set(r.medName, (m.get(r.medName) || 0) + Math.round(r.value)); catTop.set(k, m); }
  for (const g of byCategory) {
    g.prevValue = prevCat.has(g.key) ? prevCat.get(g.key) : null;
    const m = catTop.get(g.key); g.topMed = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
  }

  // individual reasons (finer than the 5 groups) and patient-safety signals
  const byReason = groupReturns(cur, 'reason');
  const reasonDetail = byReason.flatMap((g) => (g.children || []).map((c) => ({ ...c, icon: g.icon, group: g.label }))).sort((a, b) => b.value - a.value);
  const adrRows = live.filter((r) => baseReason(r) === ADR_REASON);
  const adrByDrug = new Map(); for (const r of adrRows) adrByDrug.set(r.medName, (adrByDrug.get(r.medName) || 0) + 1);
  const safety = {
    adr: { count: adrRows.length, drugs: [...adrByDrug.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 4) },
    error: { count: live.filter((r) => reasonGroupOf(baseReason(r)).key === 'error').length },
    cancelled: cur.filter((r) => isReversal(r.reason)).length,
  };
  const avgPerReturn = t.count > 0 ? Math.round(t.value / t.count) : 0;

  const out = {
    month, trend, trendInfo: analyzeTrend(trend), yoy,
    total: { count: t.count, value: t.value, qty: t.qty, hn: new Set(live.map((r) => r.hn)).size, avg: avgPerReturn },
    prev: prev ? { count: prev.count, value: prev.value } : null,
    byCategory, byReason, reasonDetail, topMeds, daily, weekday, peakDay, safety,
    empty: cur.length === 0,
  };
  out.insights = buildInsights(out);
  return out;
}

/** Plain-language observations (facts only, no clinical advice) so the report reads on its own. */
export function buildInsights(rep) {
  const out = [];
  if (rep.empty) return out;
  const { total, prev, yoy, trendInfo, peakDay, safety } = rep;
  if (prev && prev.value > 0) { const d = Math.round(((total.value - prev.value) / prev.value) * 100); out.push(`มูลค่าคืน${d >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(d)}% จากเดือนก่อน (${nf(prev.value)} → ${nf(total.value)} บาท)`); }
  if (yoy && yoy.value > 0) { const d = Math.round(((total.value - yoy.value) / yoy.value) * 100); out.push(`เทียบเดือนเดียวกันปีก่อน (${monthShort(yoy.month)}): ${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% (${nf(yoy.value)} บาท)`); }
  if (trendInfo.dir !== 'flat') out.push(`แนวโน้ม 6 เดือน${trendInfo.dir === 'up' ? 'เพิ่มขึ้น' : 'ลดลง'} ~${nf(Math.abs(trendInfo.slope))} บาท/เดือน`);
  if (peakDay.value > 0) out.push(`วันที่คืนมูลค่าสูงสุด: วันที่ ${peakDay.day} (${nf(peakDay.value)} บาท · ${nf(peakDay.count)} ครั้ง)`);
  const wd = [...rep.weekday].sort((a, b) => b.count - a.count)[0];
  if (wd && wd.count > 0 && total.count >= 10) out.push(`วันในสัปดาห์ที่คืนบ่อยที่สุด: ${wd.label} (${nf(wd.count)} ครั้ง, ${Math.round((wd.count / total.count) * 100)}%)`);
  const risers = rep.byCategory.filter((g) => g.prevValue != null).map((g) => ({ g, d: g.value - g.prevValue })).sort((a, b) => b.d - a.d);
  if (risers[0] && risers[0].d > 0) out.push(`หมวดที่เพิ่มมากที่สุด: ${risers[0].g.label} (+${nf(risers[0].d)} บาท)`);
  if (safety.adr.count > 0) out.push(`⚠ คืนเพราะแพ้ยา/ผลข้างเคียง ${nf(safety.adr.count)} ครั้ง` + (safety.adr.drugs.length ? ` (${safety.adr.drugs.map((d) => d.name).slice(0, 3).join(', ')})` : ''));
  if (safety.error.count > 0) out.push(`⚠ คืนเพราะความคลาดเคลื่อนในการจ่ายยา ${nf(safety.error.count)} ครั้ง`);
  if (safety.cancelled > 0) out.push(`มีการยกเลิกรายการคืน ${nf(safety.cancelled)} รายการ (หักออกจากยอดแล้ว)`);
  return out;
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
      ...(rep.yoy && rep.yoy.value > 0 ? [{ type: 'text', text: `เทียบ ${monthShort(rep.yoy.month)} (ปีก่อน): ${total.value >= rep.yoy.value ? '▲' : '▼'} ${Math.abs(Math.round(((total.value - rep.yoy.value) / rep.yoy.value) * 100))}% (${nf(rep.yoy.value)} บาท)`, size: 'xxs', color: '#546E7A', wrap: true }] : []),
      { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [statTile('ครั้งที่คืน', nf(total.count), '#02B0AE', '#007371'), statTile('ผู้ป่วย (HN)', nf(total.hn), '#7C4DFF', '#4527A0'), statTile('เฉลี่ย/ครั้ง (บาท)', nf(total.avg), '#FFA726', '#E65100')] },
      ...(rep.safety.adr.count + rep.safety.error.count > 0 ? [{ type: 'box', layout: 'vertical', backgroundColor: '#FFEBEE', cornerRadius: '8px', paddingAll: '8px', contents: [{ type: 'text', text: `⚠ ข้อควรเฝ้าระวัง: แพ้ยา/ผลข้างเคียง ${nf(rep.safety.adr.count)} ครั้ง · ความคลาดเคลื่อนการจ่ายยา ${nf(rep.safety.error.count)} ครั้ง`, size: 'xxs', color: '#B71C1C', weight: 'bold', wrap: true }] }] : []),
      ...(topCat ? [{ type: 'text', text: `🗂 หมวดมูลค่าสูงสุด: ${topCat.label} (${nf(topCat.value)} บาท)`, size: 'xs', wrap: true, color: '#12211A' }] : []),
      ...(topReason ? [{ type: 'text', text: `💬 เหตุผลหลัก: ${topReason.icon ?? ''} ${topReason.label} (${nf(topReason.value)} บาท)`, size: 'xs', wrap: true, color: '#12211A' }] : []),
      { type: 'text', text: 'ปัดการ์ดไปทางซ้ายเพื่อดู: แนวโน้ม · รายวัน · หมวดยา · เหตุผล · ยาคืนสูงสุด · ข้อสังเกต', size: 'xxs', color: '#8A918B', wrap: true },
    ] },
    footer: footerBtn('ดูทุกหมวดในแอป', link(rep.month, 'all'), '#007371') };
}

// Flex has no chart element, so charts are drawn with boxes: a column's height in px IS the value (max 96px).
const compact = (v) => { const a = Math.abs(v); return a >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : a >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)); };
/** items: [{label, value, color, bold}] — columns with the value above each bar and the label below. */
export function columnChart(items, { maxHeight = 96, avg } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const cols = items.map((i) => ({ type: 'box', layout: 'vertical', flex: 1, justifyContent: 'flex-end', contents: [
    { type: 'text', text: compact(i.value), size: 'xxs', color: i.color, weight: i.bold ? 'bold' : 'regular', align: 'center', wrap: false },
    { type: 'box', layout: 'vertical', height: Math.max(3, Math.round((Math.max(0, i.value) / max) * maxHeight)) + 'px', margin: 'xs', backgroundColor: i.color, cornerRadius: '4px', contents: [{ type: 'filler' }] },
  ] }));
  const labels = items.map((i) => ({ type: 'text', text: i.label, size: 'xxs', align: 'center', color: i.bold ? '#12211A' : '#78909C', weight: i.bold ? 'bold' : 'regular', flex: 1, wrap: false }));
  return [
    { type: 'box', layout: 'horizontal', spacing: 'sm', height: (maxHeight + 22) + 'px', contents: cols },
    { type: 'separator', margin: 'sm' },
    { type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm', contents: labels },
    ...(avg != null ? [{ type: 'text', text: `เฉลี่ย ${nf(avg)} บาท/เดือน`, size: 'xxs', color: '#78909C', margin: 'sm', align: 'center' }] : []),
  ];
}
/** Proportional strip (100% stacked bar): [{label, value, color}] → one rounded bar, widths in whole percents. */
export function stackStrip(parts) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (!(total > 0)) return null;
  const segs = parts.filter((p) => p.value > 0).map((p) => ({ type: 'box', layout: 'vertical', flex: Math.max(1, Math.round((p.value / total) * 100)), backgroundColor: p.color, contents: [{ type: 'filler' }] }));
  return { type: 'box', layout: 'horizontal', height: '12px', cornerRadius: '6px', spacing: 'xs', contents: segs };
}
const PALETTE = ['#02B0AE', '#7C4DFF', '#FF7043', '#FFB300', '#EC407A', '#26A69A', '#5C6BC0', '#90A4AE'];
const trendText = (t) => t.dir === 'up' ? { text: `▲ แนวโน้มเพิ่มขึ้น ~${nf(Math.abs(t.slope))} บาท/เดือน`, color: '#C62828' } : t.dir === 'down' ? { text: `▼ แนวโน้มลดลง ~${nf(Math.abs(t.slope))} บาท/เดือน`, color: '#2E7D32' } : { text: '► แนวโน้มทรงตัว', color: '#546E7A' };

function trendCard(rep) {
  const t = trendText(rep.trendInfo);
  const items = rep.trend.map((x) => {
    const cur = x.month === rep.month;
    return { label: monthShort(x.month).split(' ')[0], value: x.value, color: cur ? '#4527A0' : '#B39DDB', bold: cur };
  });
  const countRow = { type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', contents: rep.trend.map((x) => ({ type: 'text', text: String(x.count), size: 'xxs', align: 'center', flex: 1, color: x.month === rep.month ? '#4527A0' : '#78909C', weight: x.month === rep.month ? 'bold' : 'regular' })) };
  return { type: 'bubble', size: 'mega',
    header: header('📈', 'แนวโน้ม 6 เดือน', 'มูลค่ายาที่คืนในแต่ละเดือน (บาท)', '#7C4DFF', '#4527A0'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
      { type: 'text', text: t.text, size: 'sm', weight: 'bold', color: t.color, wrap: true },
      { type: 'box', layout: 'vertical', margin: 'md', contents: columnChart(items, { avg: rep.trendInfo.avg }) },
      { type: 'text', text: 'จำนวนครั้งที่คืนในแต่ละเดือน', size: 'xxs', color: '#78909C', margin: 'md', align: 'center' },
      countRow,
      ...(rep.trendInfo.peakMonth ? [{ type: 'text', text: `สูงสุด: ${monthLabel(rep.trendInfo.peakMonth)} (${nf(rep.trendInfo.peakValue)} บาท)`, size: 'xxs', color: '#546E7A', margin: 'md', wrap: true }] : []),
    ] },
    footer: footerBtn('เปิดรายงานในแอป', link(rep.month, 'all'), '#4527A0') };
}

function groupsCard(rep, by, limit = 7) {
  const groups = by === 'cat' ? rep.byCategory : rep.byReason;
  const shown = groups.slice(0, limit);
  const rest = groups.slice(limit);
  const total = Math.max(1, groups.reduce((s, g) => s + Math.max(0, g.value), 0));
  const colorOf = (i) => PALETTE[Math.min(i, PALETTE.length - 1)];
  const strip = stackStrip([...shown.map((g, i) => ({ value: g.value, color: colorOf(i) })), ...(rest.length ? [{ value: rest.reduce((s, g) => s + Math.max(0, g.value), 0), color: '#CFD8DC' }] : [])]);
  const rows = shown.map((g, i) => ({ type: 'box', layout: 'vertical', margin: 'md', contents: [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'box', layout: 'vertical', width: '10px', height: '10px', flex: 0, margin: 'none', backgroundColor: colorOf(i), cornerRadius: '3px', contents: [{ type: 'filler' }] },
      { type: 'text', text: `${g.icon ? g.icon + ' ' : ''}${g.label}`, size: 'sm', weight: 'bold', wrap: true, flex: 6, color: '#12211A', margin: 'sm' },
      { type: 'text', text: `${nf(g.value)}`, size: 'sm', weight: 'bold', align: 'end', flex: 3, color: by === 'cat' ? '#007371' : '#BF360C' },
    ] },
    { type: 'text', text: `${nf(g.count)} ครั้ง · ${Math.round((Math.max(0, g.value) / total) * 100)}% ของมูลค่า` + (by === 'reason' && g.children?.[0] ? ` · มาก: ${g.children[0].label}` : ''), size: 'xxs', color: '#6D736D', wrap: true },
    ...(by === 'cat' && g.prevValue != null && g.prevValue !== 0 ? [{ type: 'text', text: `${g.value >= g.prevValue ? '▲' : '▼'} ${nf(Math.abs(g.value - g.prevValue))} จากเดือนก่อน (${nf(g.prevValue)})${g.topMed ? ' · หลัก: ' + g.topMed : ''}`, size: 'xxs', color: g.value >= g.prevValue ? '#C62828' : '#2E7D32', wrap: true }] : (by === 'cat' && g.topMed ? [{ type: 'text', text: `หลัก: ${g.topMed}`, size: 'xxs', color: '#6D736D', wrap: true }] : [])),
    bar((Math.max(0, g.value) / total) * 100, colorOf(i)),
  ] }));
  if (rest.length) rows.push({ type: 'text', text: `…และอีก ${rest.length} กลุ่ม (${nf(rest.reduce((s, g) => s + g.value, 0))} บาท) — ดูในแอป`, size: 'xs', color: '#8A918B', margin: 'md', wrap: true });
  if (!groups.length) rows.push({ type: 'text', text: 'ไม่มีข้อมูล', size: 'sm', color: '#8A918B' });
  return { type: 'bubble', size: 'mega',
    header: by === 'cat' ? header('🗂', 'แยกตามหมวดหมู่ยา', `${monthLabel(rep.month)} · มูลค่า (บาท)`, '#02B0AE', '#004C4B') : header('💬', 'แยกตามเหตุผลการคืนยา', `${monthLabel(rep.month)} · มูลค่า (บาท)`, '#FF8A65', '#BF360C'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [...(strip ? [strip] : []), ...rows] },
    footer: footerBtn(by === 'cat' ? 'ดูแยกตามหมวดยา' : 'ดูแยกตามเหตุผล', link(rep.month, by), by === 'cat' ? '#007371' : '#BF360C') };
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

/** Daily pattern: columns for every day of the month (value), then the five weekdays + weekend (count). */
function dailyCard(rep, withWeekday = true) {
  const maxV = Math.max(1, ...rep.daily.map((d) => d.value));
  // one box per day, bottom-aligned by the ROW (alignItems:flex-end) — no wrapper box per column keeps 31 columns small
  const cols = rep.daily.map((d) => ({ type: 'box', layout: 'vertical', flex: 1, height: Math.max(2, Math.round((Math.max(0, d.value) / maxV) * 70)) + 'px', backgroundColor: d.day === rep.peakDay.day ? '#E65100' : '#26A69A', contents: [{ type: 'filler' }] }));
  const n = rep.daily.length;
  const dayLabels = [1, 10, 20, n].map((d) => ({ type: 'text', text: String(d), size: 'xxs', color: '#78909C', flex: 0 }));
  const maxW = Math.max(1, ...rep.weekday.map((w) => w.count));
  const wd = rep.weekday.map((w) => ({ label: w.label, value: w.count, color: w.count === maxW && w.count > 0 ? '#E65100' : '#80CBC4', bold: w.count === maxW && w.count > 0 }));
  return { type: 'bubble', size: 'mega',
    header: header('🗓', 'ลักษณะการคืนรายวัน', `${monthLabel(rep.month)} · แท่งสูง = มูลค่ามาก`, '#26A69A', '#00695C'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
      { type: 'text', text: 'มูลค่ายาที่คืนในแต่ละวัน (บาท)', size: 'xs', weight: 'bold', color: '#12211A' },
      { type: 'box', layout: 'horizontal', spacing: 'xs', height: '72px', alignItems: 'flex-end', margin: 'md', contents: cols },
      { type: 'separator', margin: 'sm' },
      { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'sm', contents: dayLabels },
      ...(rep.peakDay.value > 0 ? [{ type: 'text', text: `สูงสุด: วันที่ ${rep.peakDay.day} · ${nf(rep.peakDay.value)} บาท · ${nf(rep.peakDay.count)} ครั้ง`, size: 'xxs', color: '#E65100', weight: 'bold', margin: 'sm', align: 'center' }] : []),
      ...(withWeekday ? [
        { type: 'text', text: 'จำนวนครั้งที่คืนตามวันในสัปดาห์', size: 'xs', weight: 'bold', color: '#12211A', margin: 'xl' },
        { type: 'box', layout: 'vertical', margin: 'md', contents: columnChart(wd, { maxHeight: 56 }) },
      ] : []),
    ] },
    footer: footerBtn('เปิดรายงานในแอป', link(rep.month, 'all'), '#00695C') };
}

/** Individual reasons (finer than the five groups), ranked, with the patient-safety flags underneath. */
function reasonDetailCard(rep, limit = 7) {
  const items = rep.reasonDetail.filter((r) => r.value > 0 || r.count > 0).slice(0, limit);
  const max = Math.max(1, ...items.map((r) => r.value));
  const rows = items.map((r) => ({ type: 'box', layout: 'vertical', margin: 'md', contents: [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: `${r.icon ? r.icon + ' ' : ''}${r.label}`, size: 'xs', weight: 'bold', wrap: true, flex: 6, color: '#12211A' },
      { type: 'text', text: nf(r.value), size: 'xs', weight: 'bold', align: 'end', flex: 2, color: '#BF360C' },
    ] },
    { type: 'text', text: `${nf(r.count)} ครั้ง`, size: 'xxs', color: '#6D736D' },
    bar((Math.max(0, r.value) / max) * 100, '#FF7043'),
  ] }));
  const warn = [];
  if (rep.safety.adr.count > 0) warn.push({ type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: '#FFEBEE', cornerRadius: '8px', paddingAll: '8px', contents: [
    { type: 'text', text: `⚠ แพ้ยา/ผลข้างเคียง ${nf(rep.safety.adr.count)} ครั้ง`, size: 'xs', weight: 'bold', color: '#B71C1C' },
    ...(rep.safety.adr.drugs.length ? [{ type: 'text', text: rep.safety.adr.drugs.map((d) => `${d.name}${d.count > 1 ? ' ×' + d.count : ''}`).join(' · '), size: 'xxs', color: '#B71C1C', wrap: true }] : []),
  ] });
  if (rep.safety.error.count > 0) warn.push({ type: 'box', layout: 'vertical', margin: 'sm', backgroundColor: '#FFF3E0', cornerRadius: '8px', paddingAll: '8px', contents: [
    { type: 'text', text: `⚠ ความคลาดเคลื่อนในการจ่ายยา ${nf(rep.safety.error.count)} ครั้ง`, size: 'xs', weight: 'bold', color: '#E65100' },
  ] });
  return { type: 'bubble', size: 'mega',
    header: header('🔎', 'เหตุผลการคืนแบบละเอียด', `${monthLabel(rep.month)} · เรียงตามมูลค่า (บาท)`, '#FF8A65', '#D84315'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [...(rows.length ? rows : [{ type: 'text', text: 'ไม่มีข้อมูล', size: 'sm', color: '#8A918B' }]), ...warn] },
    footer: footerBtn('ดูแยกตามเหตุผล', link(rep.month, 'reason'), '#BF360C') };
}

function insightsCard(rep) {
  return { type: 'bubble', size: 'mega',
    header: header('💡', 'ข้อสังเกตจากรายงาน', `${monthLabel(rep.month)} · สรุปให้อ่านจบในที่เดียว`, '#5C6BC0', '#283593'),
    body: { type: 'box', layout: 'vertical', paddingAll: '12px', spacing: 'md', contents: rep.insights.map((t) => ({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      { type: 'text', text: '•', size: 'sm', color: '#283593', flex: 0, weight: 'bold' },
      { type: 'text', text: t, size: 'xs', wrap: true, color: t.startsWith('⚠') ? '#B71C1C' : '#12211A', weight: t.startsWith('⚠') ? 'bold' : 'regular' },
    ] })) },
    footer: footerBtn('เปิดรายงานในแอป', link(rep.month, 'all'), '#283593') };
}

// LINE limits (documented): a bubble's JSON ≤ 10 KB, a carousel's ≤ 50 KB. Budget below those with margin.
const FLEX_MAX_BYTES = 38000;
const BUBBLE_MAX_BYTES = 9500;
export function buildMonthlyFlex(rep) {
  const make = (limit, drop = []) => {
    const bubbles = [summaryCard(rep)];
    if (!rep.empty) {
      bubbles.push(trendCard(rep), dailyCard(rep, !drop.includes('weekday')), groupsCard(rep, 'cat', limit), groupsCard(rep, 'reason', limit));
      if (!drop.includes('detail')) bubbles.push(reasonDetailCard(rep, limit));
      if (!drop.includes('top')) bubbles.push(topMedsCard(rep));
      if (rep.insights.length) bubbles.push(insightsCard(rep));
    }
    return { type: 'flex', altText: `รายงานคืนยา ${monthLabel(rep.month)} — ${nf(rep.total.value)} บาท · ${nf(rep.total.count)} ครั้ง`.slice(0, 400), contents: { type: 'carousel', contents: bubbles } };
  };
  const fits = (f) => JSON.stringify(f).length <= FLEX_MAX_BYTES && f.contents.contents.every((b) => JSON.stringify(b).length <= BUBBLE_MAX_BYTES);
  // Many categories/reasons could push a card past the limits — show fewer rows per card first (the app has the full list), and only if
  // that is not enough drop the optional extras one by one.
  const attempts = [[7, []], [6, []], [5, []], [4, []], [3, []], [3, ['weekday']], [3, ['weekday', 'detail']], [3, ['weekday', 'detail', 'top']]];
  let flex = make(7);
  for (const [limit, drop] of attempts) { flex = make(limit, drop); if (fits(flex)) break; }
  return flex;
}

// ---- main ---------------------------------------------------------------------------------------------------------------------------
export async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const arg = process.argv.find((a) => a.startsWith('--month='));
  const month = arg ? arg.slice(8) : (process.env.REPORT_MONTH || previousMonthOf(Date.now()));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { console.error('Bad month (expected YYYY-MM): ' + month); process.exit(1); }
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
  const w = await waitUntilBangkokTime(process.env.TARGET_TIME_BKK, { lateUntil: '18:00' }); // start early, send on the exact Bangkok minute
  if (w.skip) { console.log('::warning::Skipped — the scheduled run was not on time, nothing was sent.'); return; }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();
  const from = monthRange(shiftMonth(month, -12)).from; const to = monthRange(month).to; // 13 months: trend + previous month + same month last year
  try {
    // `date` is a single-field range (+ orderBy on the same field) — no composite index. ~13 months of returns, once a month.
    const snap = await db.collection('returns').where('date', '>=', from).where('date', '<=', to).orderBy('date', 'asc').get();
    const records = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    console.log(`Returns ${from}..${to}: ${records.length} rows`);
    const rep = buildMonthlyReport({ records, month });
    console.log(`${monthLabel(month)}: ${rep.total.count} returns, ${rep.total.value} baht`);
    const flex = buildMonthlyFlex(rep);
    if (dryRun) { console.log(JSON.stringify(flex.contents.contents.length) + ' cards, ' + JSON.stringify(flex).length + ' bytes (--dry-run — not sending)'); return; }
    await sendIfConfigured([flex], process.env, { required: true });
    await stampRun(db, 'monthly', 'sent', { month });
  } catch (e) {
    if (!process.argv.includes('--dry-run')) await stampRun(db, 'monthly', 'failed', { error: String(e.message || e).slice(0, 200), month });
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('Monthly returns report failed:', err); process.exit(1); });
}
