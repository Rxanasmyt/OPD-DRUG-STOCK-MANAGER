import rawCsv from './med_list.csv?raw';
import { parseCsv } from '../utils/csv';
import { mulberry32, DAY } from '../utils/format';
import type { Med, Lot } from '../types';

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

