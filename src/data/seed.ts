import rawCsv from './med_list.csv?raw';
import { parseCsv } from '../utils/csv';
import { mulberry32 } from '../utils/format';
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
    // Bug fix (real deployment correctness): this used to randomly generate a "plausible"
    // starting floor quantity — fine for a demo, actively wrong for the real first-time setup
    // at รพ.กรงปินัง this function actually seeds (seedInitialData() is the ONLY caller, wired
    // to HomeScreen's real "โหลดข้อมูลตั้งต้น" button, not a separate demo mode). A brand-new
    // hospital deployment has never counted a single tablet through this system yet — every
    // floor quantity must start at 0 so staff are forced to do the real physical count before
    // the app shows anything as "in stock", instead of quietly inheriting a fabricated number
    // nobody actually counted. par targets (parSub/parFloor) and usage-rate estimates stay —
    // those are starting CONFIGURATION (what to aim for, editable any time in หน้าตั้งค่า), not
    // a claim about what's physically on a shelf right now.
    const floor = 0;
    const used30 = active ? Math.max(1, Math.round(parFloor * (0.8 + rng() * 1.4))) : 0;
    const trendFactor = 0.8 + rng() * 0.5;
    const usedPrev30 = active ? Math.max(1, Math.round(used30 / trendFactor)) : 0;
    const volatility = 1.05 + rng() * 0.35;
    const bin = String.fromCharCode(65 + Math.floor(rng() * 6)) + (1 + Math.floor(rng() * 4));

    meds.push({
      id, code, name, unit, dosageForm, price, had, active,
      parSub, parFloor, floor, bin, used30, usedPrev30, volatility,
      // No lastCountTs — a fabricated "counted 0-9 days ago" timestamp claimed a physical count
      // had already happened when it never did. Leaving it unset correctly shows "ยังไม่เคยนับ"
      // in CountScreen (see its own null-guard) instead of a misleadingly recent fake date.
    });
  }
  return meds;
}

// Bug fix (real deployment correctness): this used to invent random lot numbers/expiry dates/
// quantities so the demo formulary had something to look at — the same problem loadMasterMeds()
// above had with floor, just worse here, since a "lot" is a specific real physical container
// with a real lot number and a real expiry date printed on it. Fabricating one out of thin air
// isn't just an inaccurate number like a floor quantity — it's a completely made-up record that
// could never correspond to anything on an actual shelf, and would sit in substock reading as
// real received stock until someone noticed and manually deleted it. seedInitialData() is the
// real first-time-setup path (see its own doc comment / HomeScreen's "โหลดข้อมูลตั้งต้น" button),
// not a demo — a fresh deployment hasn't received a single real lot through this system yet, so
// there is nothing honest to seed here. substock naturally reads 0 for everything with no lots
// (subQty() sums an empty list), which is exactly correct until real receiving happens.
export function seedLots(_meds: Med[]): Lot[] {
  return [];
}

