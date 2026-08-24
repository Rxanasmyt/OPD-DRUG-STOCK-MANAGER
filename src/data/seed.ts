import rawCsv from './med_list.csv?raw';
import { parseCsv } from '../utils/csv';
import { mulberry32, DAY } from '../utils/format';
import type { Med, Lot, Tx, User } from '../types';

const NOT_CARRIED_RE = /ไม่มี|refer back|เตรียมเฉพาะราย|เฉพาะราย/i;
const HAD_RE = /^\(HAD\)\s*/i;

function roundStep(v: number): number {
  const step = v >= 500 ? 100 : v >= 100 ? 10 : 1;
  return Math.max(step, Math.ceil(v / step) * step);
}

function baseVolume(price: number): number {
  if (price <= 0) return 3000;
  if (price <= 1) return 15000;
  if (price <= 3) return 6000;
  if (price <= 10) return 2000;
  if (price <= 50) return 500;
  if (price <= 200) return 120;
  if (price <= 1000) return 30;
  return 8;
}

export function loadMasterMeds(): Med[] {
  const rows = parseCsv(rawCsv.trim());
  const now = Date.now();
  const meds: Med[] = [];
  let idx = 0;
  for (const r of rows) {
    if (r.length < 5) continue;
    const no = r[0].trim();
    if (!/^\d+$/.test(no)) continue; // skip header row + printer footer row
    let name = r[1].trim();
    const dosageForm = (r[2] || '').trim();
    const unit = (r[3] || '').trim() || 'หน่วย';
    const priceRaw = (r[4] || '').replace(/,/g, '').trim();
    const price = parseFloat(priceRaw) || 0;
    const had = HAD_RE.test(name);
    if (had) name = name.replace(HAD_RE, '').trim();
    const active = !NOT_CARRIED_RE.test(name);

    idx++;
    const id = 'M' + String(idx).padStart(3, '0');
    const code = 'MED-' + String(idx).padStart(4, '0');
    const rng = mulberry32(idx * 2654435761);

    const base = baseVolume(price || 1);
    const parSub = active ? roundStep(base) : 0;
    const parFloor = active ? roundStep(base * 0.15) : 0;
    const floor = active ? Math.round(parFloor * (0.15 + rng() * 1.15)) : 0;
    const used30 = active ? Math.max(1, Math.round(parFloor * (0.8 + rng() * 1.4))) : 0;
    const trendFactor = 0.8 + rng() * 0.5;
    const usedPrev30 = active ? Math.max(1, Math.round(used30 / trendFactor)) : 0;
    const volatility = 1.05 + rng() * 0.35;
    const bin = String.fromCharCode(65 + Math.floor(rng() * 6)) + (1 + Math.floor(rng() * 4));
    const lastCountTs = now - Math.floor(rng() * 9) * DAY;

    meds.push({
      id, code, name, unit, dosageForm, price, had, active,
      parSub, parFloor, floor, bin, used30, usedPrev30, volatility, lastCountTs,
    });
  }
  return meds;
}

export function seedLots(meds: Med[]): Lot[] {
  const now = Date.now();
  const lots: Lot[] = [];
  meds.forEach((m, i) => {
    if (!m.active) return;
    const rng = mulberry32(i * 40503 + 7);
    const n = rng() < 0.35 ? 2 : 1;
    const total = Math.max(0, Math.round(m.parSub * (0.35 + rng() * 0.55)));
    for (let k = 0; k < n; k++) {
      const roll = rng();
      // small fraction of lots are expired or expiring soon, for a realistic demo mix
      const days = roll < 0.08 ? -Math.round(rng() * 20) : roll < 0.22 ? Math.round(rng() * 85) : Math.round(90 + rng() * 820);
      const lotSeason = String.fromCharCode(65 + Math.floor(rng() * 6)) + (2600 + Math.floor(rng() * 20)) + String(10 + Math.floor(rng() * 80));
      lots.push({
        id: 'L' + m.id + k,
        code: 'LOT-' + m.id.slice(1) + '-' + (k + 1),
        medId: m.id,
        lotNo: lotSeason,
        exp: now + days * DAY,
        qty: Math.max(0, Math.round(total / n)),
        loc: 'ชั้น ' + m.bin,
      });
    }
  });
  return lots;
}

export function seedTxs(meds: Med[]): Tx[] {
  const now = Date.now();
  const active = meds.filter((m) => m.active);
  const pick = (i: number) => active[i % active.length];
  const m0 = pick(2), m1 = pick(9), m2 = pick(4), m3 = pick(15), m4 = pick(6), m5 = pick(1);
  return [
    { id: 'T1', type: 'adjust', name: m0.name, qty: -Math.min(60, Math.max(5, m0.floor || 20)), unit: m0.unit, by: 'ภญ.นูรฮายาตี ส.', ts: now - 2 * DAY, reason: 'นับได้ต่างจากระบบ', note: 'ตรวจนับรอบเดือน ส.ค. ร่วมกับ อับดุลเลาะ ม.', loc: 'substock' },
    { id: 'T2', type: 'expired', name: m1.name, qty: -Math.min(120, Math.max(10, m1.floor || 30)), unit: m1.unit, by: 'ภญ.นูรฮายาตี ส.', ts: now - 5 * DAY, reason: 'หมดอายุ', note: 'ตัดออกจาก substock ตามรอบตรวจ', loc: 'substock' },
    { id: 'T3', type: 'return', name: m2.name, qty: Math.min(40, Math.max(5, Math.round((m2.floor || 20) * 0.2))), unit: m2.unit, by: 'อับดุลเลาะ ม.', ts: now - 6 * DAY, reason: 'ผู้ป่วยคืนยา (ไม่เปิดซอง)', note: 'HN 00214477 นัดเปลี่ยนแผนการรักษา', loc: 'floor' },
    { id: 'T4', type: 'adjust', name: m3.name, qty: -Math.min(25, Math.max(3, Math.round((m3.floor || 15) * 0.15))), unit: m3.unit, by: 'อับดุลเลาะ ม.', ts: now - 9 * DAY, reason: 'เบิกใช้ในหน่วยงาน', note: 'ให้ ER ช่วงระบาด', loc: 'floor' },
    { id: 'T5', type: 'expired', name: m4.name, qty: -Math.min(6, Math.max(1, Math.round((m4.floor || 6) * 0.1))), unit: m4.unit, by: 'ภญ.นูรฮายาตี ส.', ts: now - 12 * DAY, reason: 'ยาเสีย/ชำรุด', note: 'ตะกอนผิดปกติหลังผสม', loc: 'floor' },
    { id: 'T6', type: 'adjust', name: m5.name, qty: -Math.min(8, Math.max(1, Math.round((m5.floor || 8) * 0.05))), unit: m5.unit, by: 'ภญ.นูรฮายาตี ส.', ts: now - 15 * DAY, reason: 'นับได้ต่างจากระบบ', note: 'high alert — ทวนสอบ 2 คน ตามแนวทาง CQI', loc: 'floor' },
  ];
}

export function seedUsers(): User[] {
  const now = Date.now();
  return [
    { id: 'U1', name: 'ภญ.นูรฮายาตี ส.', role: 'pharm', dept: 'เภสัชกรรม', active: true, lastLogin: now - 0.4 * DAY },
    { id: 'U2', name: 'อับดุลเลาะ ม.', role: 'tech', dept: 'เภสัชกรรม', active: true, lastLogin: now - 0.1 * DAY },
    { id: 'U3', name: 'ผู้ดูแลระบบ', role: 'admin', dept: 'IT', active: true, lastLogin: now - 3 * DAY },
    { id: 'U4', name: 'ซากีนะ เจ๊ะมะ', role: 'tech', dept: 'เภสัชกรรม', active: true, lastLogin: now - 2 * DAY },
    { id: 'U5', name: 'ภก.อิสมาแอล ดอเลาะ', role: 'pharm', dept: 'เภสัชกรรม', active: false, lastLogin: now - 40 * DAY },
  ];
}
