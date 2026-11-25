import { describe, it, expect } from 'vitest';
import { analyzeTrend, columnChart, stackStrip, buildMonthlyReport, buildMonthlyFlex, groupReturns as scriptGroup, monthLabel, shiftMonth, previousMonthOf, monthRange, CATEGORY_LABELS, REVERSAL_PREFIX } from './notify-monthly-returns.mjs';
import { groupReturns as appGroup } from '../src/utils/returnsSummary';
import { RETURN_REASON_GROUPS, REVERSAL_PREFIX as APP_REVERSAL } from '../src/utils/returnReasons';
import { DRUG_CATEGORIES } from '../src/data/categories';

const rec = (o) => ({ id: o.id ?? 'r' + Math.random().toString(36).slice(2, 8), medId: 'm1', medName: 'PARACETAMOL 500 mg', medCode: 'M1', unit: 'เม็ด', category: 'pain', hn: '1', qty: 10, unitPrice: 2, value: 20, reason: 'ปรับเปลี่ยนการรักษา', note: '', date: '2026-10-15', ts: Date.parse('2026-10-15T03:00:00Z'), by: 'x', ...o });
const data = [
  rec({ id: 'a', value: 200, qty: 100, hn: '1' }),
  rec({ id: 'b', category: 'cardio', medId: 'm2', medName: 'AMLODIPINE', value: 600, qty: 300, hn: '2', reason: 'Non-compliance' }),
  rec({ id: 'c', category: 'cardio', medId: 'm2', medName: 'AMLODIPINE', value: 100, qty: 50, hn: '3', reason: 'ไม่ประสงค์รับยา' }),
  // cancelled: original c is cancelled by a reversal row
  rec({ id: 'rev', category: 'cardio', medId: 'm2', medName: 'AMLODIPINE', value: 100, qty: 50, hn: '3', reason: REVERSAL_PREFIX + 'ไม่ประสงค์รับยา', note: '#c' }),
  rec({ id: 'd', value: 50, qty: 20, hn: '4', reason: 'เหตุผลที่พิมพ์เอง' }),
  rec({ id: 'old', value: 10, qty: 5, hn: '5', reason: '' }),
  // previous months
  rec({ id: 'p1', date: '2026-09-10', value: 400, qty: 80 }),
  rec({ id: 'p2', date: '2026-08-10', value: 100, qty: 20 }),
];

describe('monthly returns report — numbers', () => {
  const rep = buildMonthlyReport({ records: data, month: '2026-10' });
  it('nets a cancelled return to zero and counts only live originals', () => {
    expect(rep.total.value).toBe(200 + 600 + 50 + 10); // c cancelled by rev
    expect(rep.total.count).toBe(4); // a, b, d, old (c cancelled, rev not counted)
    expect(rep.total.hn).toBe(4);
  });
  it('compares with the previous month and has a 6-month trend ending at the report month', () => {
    expect(rep.prev).toEqual({ count: 1, value: 400 });
    expect(rep.trend).toHaveLength(6);
    expect(rep.trend[5].month).toBe('2026-10');
    expect(rep.trend[0].month).toBe('2026-05');
  });
  it('groups by category and by reason (reversal counts against the ORIGINAL reason; free text and missing reasons have their own buckets)', () => {
    expect(rep.byCategory.map((g) => [g.key, g.value, g.count])).toEqual([['cardio', 600, 1], ['pain', 260, 3]]);
    const r = Object.fromEntries(rep.byReason.map((g) => [g.key, [g.value, g.count]]));
    expect(r.patient).toEqual([600, 1]); // Non-compliance 600 + ไม่ประสงค์รับยา (100 - 100)
    expect(r.treat).toEqual([200, 1]);
    expect(r.other).toEqual([50, 1]);
    expect(r.unknown).toEqual([10, 1]);
  });
  it('lists top returned drugs by value', () => {
    expect(rep.topMeds[0]).toMatchObject({ name: 'AMLODIPINE', value: 600 });
  });
  it('an empty month yields a single short card', () => {
    const e = buildMonthlyReport({ records: [], month: '2026-10' });
    expect(e.empty).toBe(true);
    expect(buildMonthlyFlex(e).contents.contents).toHaveLength(1);
  });
});

describe('monthly returns report — dates', () => {
  it('Thai month label uses the Buddhist year', () => { expect(monthLabel('2026-10')).toBe('ตุลาคม 2569'); });
  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', -5)).toBe('2026-05');
  });
  it('"previous month" is decided by the Bangkok calendar (1 Dec 00:30 Bangkok = 30 Nov UTC)', () => {
    expect(previousMonthOf(Date.parse('2026-11-30T17:30:00Z'))).toBe('2026-11'); // already 1 Dec in Bangkok
    expect(previousMonthOf(Date.parse('2026-12-01T02:00:00Z'))).toBe('2026-11');
  });
  it('month range handles February in a leap year', () => { expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' }); });
});

describe('monthly returns report — Flex', () => {
  const rep = buildMonthlyReport({ records: data, month: '2026-10' });
  const flex = buildMonthlyFlex(rep);
  it('five swipeable cards: overview, trend, by category, by reason, top drugs', () => {
    expect(flex.contents.type).toBe('carousel');
    expect(flex.contents.contents).toHaveLength(5);
    const s = JSON.stringify(flex);
    for (const t of ['รายงานคืนยารายเดือน', 'แนวโน้ม 6 เดือน', 'แยกตามหมวดหมู่ยา', 'แยกตามเหตุผลการคืนยา', 'ยาคืนมูลค่าสูงสุด']) expect(s).toContain(t);
  });
  it('buttons deep-link into the app at that month and view', () => {
    const uris = flex.contents.contents.map((b) => b.footer.contents[0].action.uri);
    expect(uris[0]).toMatch(/\?r=returns&m=2026-10&v=all$/);
    expect(uris[2]).toMatch(/&v=cat$/);
    expect(uris[3]).toMatch(/&v=reason$/);
  });
  it('stays well inside LINE limits even with many groups', () => {
    const many = Array.from({ length: 200 }, (_, i) => rec({ id: 'x' + i, medId: 'z' + i, medName: 'ยาตัวที่ ' + i, category: Object.keys(CATEGORY_LABELS)[i % 21], reason: 'เหตุผล ' + i, value: 10 + i, hn: String(i) }));
    const big = buildMonthlyFlex(buildMonthlyReport({ records: many, month: '2026-10' }));
    expect(JSON.stringify(big).length).toBeLessThan(30000);
    expect(big.altText.length).toBeLessThanOrEqual(400);
  });
});

describe('script ↔ app parity (the script keeps a copy of the app logic)', () => {
  it('reversal prefix, reason groups and category labels match the app', () => {
    expect(REVERSAL_PREFIX).toBe(APP_REVERSAL);
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(DRUG_CATEGORIES.map((c) => c.id).sort());
    for (const c of DRUG_CATEGORIES) expect(CATEGORY_LABELS[c.id]).toBe(c.label);
    const copy = RETURN_REASON_GROUPS.map((g) => g.reasons.join('|')).join('/');
    expect(copy).toBe(scriptGroupReasons());
  });
  it('grouping totals are identical in the script and the app for the same records', () => {
    for (const by of ['cat', 'reason']) {
      const a = scriptGroup(data.filter((r) => r.date.startsWith('2026-10')), by).map((g) => [g.key, g.label, g.count, g.qty, g.value]);
      const b = appGroup(data.filter((r) => r.date.startsWith('2026-10')), by).map((g) => [g.key, g.label, g.count, g.qty, g.value]);
      expect(a).toEqual(b);
    }
  });
});

// reasons per group as the script sees them, derived through its own grouping of one record per app reason
function scriptGroupReasons() {
  return RETURN_REASON_GROUPS.map((g) => g.reasons.filter((r) => scriptGroup([rec({ reason: r })], 'reason')[0].key === g.key).join('|')).join('/');
}

describe('monthly returns report — charts', () => {
  const series = (vals) => vals.map((value, i) => ({ month: '2026-0' + (i + 1), value, count: 1 }));
  it('trend direction: rising, falling and flat (within ±5%/month)', () => {
    expect(analyzeTrend(series([100, 200, 300, 400, 500, 600])).dir).toBe('up');
    expect(analyzeTrend(series([600, 500, 400, 300, 200, 100])).dir).toBe('down');
    expect(analyzeTrend(series([300, 310, 295, 305, 300, 302])).dir).toBe('flat');
    expect(analyzeTrend(series([0, 0, 0, 0, 0, 0])).dir).toBe('flat');
  });
  it('trend reports the average and the peak month', () => {
    const t = analyzeTrend(series([100, 900, 200, 200, 100, 100]));
    expect(t.avg).toBe(267);
    expect(t.peakMonth).toBe('2026-02');
  });
  it('column heights are proportional to value (tallest = 96px) and never vanish', () => {
    const cols = columnChart([{ label: 'a', value: 1000, color: '#000' }, { label: 'b', value: 500, color: '#000' }, { label: 'c', value: 0, color: '#000' }])[0].contents;
    const h = cols.map((c) => parseInt(c.contents[1].height, 10));
    expect(h).toEqual([96, 48, 3]);
  });
  it('a column must not use alignItems:center — a filler-only bar would collapse to zero width', () => {
    const col = columnChart([{ label: 'a', value: 5, color: '#000' }])[0].contents[0];
    expect(col.alignItems).toBeUndefined();
  });
  it('compact value labels (14,820 → 14.8k)', () => {
    const cols = columnChart([{ label: 'a', value: 14820, color: '#000' }, { label: 'b', value: 950, color: '#000' }])[0].contents;
    expect(cols.map((c) => c.contents[0].text)).toEqual(['14.8k', '950']);
  });
  it('stack strip uses whole-percent integer flex and skips empty parts; null when there is nothing', () => {
    const s = stackStrip([{ value: 600, color: '#a' }, { value: 300, color: '#b' }, { value: 0, color: '#c' }, { value: 100, color: '#d' }]);
    expect(s.contents.map((x) => x.flex)).toEqual([60, 30, 10]);
    expect(stackStrip([{ value: 0, color: '#a' }])).toBeNull();
  });
  it('the report carries trend info and the cards show it', () => {
    const rep = buildMonthlyReport({ records: data, month: '2026-10' });
    expect(['up', 'down', 'flat']).toContain(rep.trendInfo.dir);
    const s = JSON.stringify(buildMonthlyFlex(rep));
    expect(s).toContain('แนวโน้ม');
    expect(s).toContain('จำนวนครั้งที่คืนในแต่ละเดือน');
  });
});
