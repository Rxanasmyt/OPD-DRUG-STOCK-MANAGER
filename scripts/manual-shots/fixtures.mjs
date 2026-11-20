// Demo data for the manual screenshots — invented drugs/people only (nothing from the real hospital).
const DAY = 86400000;
const now = Date.now();
const m = (i, name, unit, form, o = {}) => ({
  id: 'm' + i, code: 'MED-' + String(i).padStart(4, '0'), name, unit, dosageForm: form, price: o.price ?? 2.5, had: !!o.had, fridge: !!o.fridge,
  active: true, parSub: o.parSub ?? 600, parFloor: o.parFloor ?? 300, floor: o.floor ?? 200, floorMin: o.floorMin ?? Math.round((o.parFloor ?? 300) * 0.4),
  bin: o.bin ?? 'A' + i, used30: o.used30 ?? 900, usedPrev30: o.usedPrev30 ?? 850, volatility: 0.2, dispenseDays30: 22, lastCountTs: now - 12 * DAY,
  reqCategory: o.reqCategory ?? 'เม็ด',
});
export const meds = [
  m(1, 'AMLODIPINE 10 mg เม็ด', 'เม็ด', 'เม็ด', { floor: 90, parFloor: 400, bin: 'C4-6', used30: 3000, parSub: 1500 }),
  m(2, 'PARACETAMOL 500 mg เม็ด', 'เม็ด', 'เม็ด', { floor: 1800, parFloor: 2000, bin: 'B1-2', used30: 9000, parSub: 6000 }),
  m(3, 'METFORMIN 500 mg เม็ด', 'เม็ด', 'เม็ด', { floor: 150, parFloor: 800, bin: 'C2-1', used30: 5200, parSub: 3000 }),
  m(4, 'SIMVASTATIN 20 mg เม็ด', 'เม็ด', 'เม็ด', { floor: 700, parFloor: 800, bin: 'C3-4', used30: 2600 }),
  m(5, 'OMEPRAZOLE 20 mg แคปซูล', 'แคปซูล', 'แคปซูล', { floor: 60, parFloor: 500, bin: 'D1-3', used30: 3400, parSub: 2000 }),
  m(6, 'AMOXICILLIN 500 mg แคปซูล', 'แคปซูล', 'แคปซูล', { floor: 420, parFloor: 600, bin: 'D2-2', used30: 2800 }),
  m(7, 'CEFTRIAXONE 1 g ขวด', 'ขวด', 'ฉีด', { floor: 25, parFloor: 120, bin: 'IPD-1', used30: 600, parSub: 300, reqCategory: 'ฉีด' }),
  m(8, 'ADRENALINE 1 mg/ml amp', 'amp', 'ฉีด', { floor: 18, parFloor: 40, bin: 'ER-1', had: true, used30: 90, reqCategory: 'ฉีด' }),
  m(9, 'INSULIN REGULAR 100 u/ml vial', 'vial', 'ฉีด', { floor: 14, parFloor: 30, bin: 'FR-1', fridge: true, price: 180, used30: 70, reqCategory: 'ฉีด' }),
  m(10, 'SALBUTAMOL 2.5 mg/2.5 ml neb', 'amp', 'พ่น', { floor: 110, parFloor: 200, bin: 'E1-1', used30: 700 }),
  m(11, 'LORATADINE 10 mg เม็ด', 'เม็ด', 'เม็ด', { floor: 380, parFloor: 400, bin: 'B2-5', used30: 1200 }),
  m(12, 'CALAMINE LOTION 120 ml', 'ขวด', 'ภายนอก', { floor: 40, parFloor: 60, bin: 'X-2', used30: 130, reqCategory: 'ภายนอก' }),
];
const lot = (i, medId, no, days, qty) => ({ id: 'l' + i, code: 'LOT-' + String(i).padStart(4, '0'), medId, lotNo: no, exp: now + days * DAY, qty, receivedTs: now - 40 * DAY });
export const lots = [
  lot(1, 'm1', 'A2609', 400, 900), lot(2, 'm1', 'A2511', 120, 400), lot(3, 'm2', 'P2701', 700, 3500), lot(4, 'm3', 'M2610', 300, 1800),
  lot(5, 'm5', 'O2608', 260, 1200), lot(6, 'm7', 'C2605', 150, 140), lot(7, 'm8', 'E2606', 210, 30), lot(8, 'm9', 'I2604', 90, 20),
];
export const floorLots = [
  { id: 'f1', medId: 'm1', lotNo: 'A2511', exp: now + 120 * DAY, qty: 90 },
  { id: 'f2', medId: 'm3', lotNo: 'M2610', exp: now + 300 * DAY, qty: 150 },
  { id: 'f3', medId: 'm5', lotNo: 'O2608', exp: now + 260 * DAY, qty: 60 },
];
export const users = [
  { id: 'demo', role: 'admin', name: 'ภก.ตัวอย่าง ใจดี', username: 'demo.admin', dept: 'เภสัชกรรม', active: true },
  { id: 'u2', role: 'tech', name: 'จพ.ตัวอย่าง รักงาน', username: 'demo.tech', dept: 'เภสัชกรรม', active: true },
  { id: 'u3', role: 'pharm', name: 'ภญ.ตัวอย่าง ขยันดี', username: 'demo.pharm', dept: 'เภสัชกรรม', active: false },
];
export const txs = [
  { id: 't1', type: 'transfer', name: 'PARACETAMOL 500 mg เม็ด', medId: 'm2', qty: 200, unit: 'เม็ด', by: 'ภก.ตัวอย่าง ใจดี', ts: now - 3 * 3600000 },
  { id: 't2', type: 'adjust', name: 'METFORMIN 500 mg เม็ด', medId: 'm3', qty: 180, unit: 'เม็ด', by: 'ภก.ตัวอย่าง ใจดี', ts: now - 26 * 3600000 },
];

const bkkToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const ret = (id, hn, medId, medName, medCode, unit, qty, price, reason, minsAgo) => ({ id, medId, medName, medCode, unit, category: 'x', hn, qty, unitPrice: price, value: qty * price, reason, note: '—', date: bkkToday, ts: now - minsAgo * 60000, by: 'ภก.ตัวอย่าง ใจดี' });
export const returnsToday = [
  ret('r1', '6612345', 'm2', 'PARACETAMOL 500 mg เม็ด', 'MED-0002', 'เม็ด', 30, 1.2, 'ยาตามอาการเหลือ', 25),
  ret('r2', '6612345', 'm3', 'METFORMIN 500 mg เม็ด', 'MED-0003', 'เม็ด', 60, 0.8, 'ยาโรคเรื้อรังเหลือเยอะ', 24),
  ret('r3', '6698765', 'm6', 'AMOXICILLIN 500 mg แคปซูล', 'MED-0006', 'แคปซูล', 14, 2.5, 'แพ้ยา/ผลข้างเคียงการรักษา', 8),
];
