// Regression test for a real request: "ตอนนี้หน้าจัดการรายการยา ประเภทยามีเพียงยากิน ยาฉีด และ
// อื่นๆ แต่ยังไม่มียาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — data/routes.ts is the single
// source of truth MedsScreen's chips, TransferScreen's route grouping, and print.ts's pick-list
// grouping all read from, so this just locks down the contract they all rely on.
import { describe, it, expect } from 'vitest';
import { ROUTES, routeLabel, routeGroupLabel } from './routes';

describe('ROUTES', () => {
  it('has exactly the 8 real-world routes requested, in a stable order', () => {
    expect(ROUTES.map((r) => r.id)).toEqual(['oral', 'injection', 'inhaled', 'topical', 'eye', 'ear', 'paint', 'other']);
  });

  it('every route has a non-empty label', () => {
    for (const r of ROUTES) expect(r.label.length).toBeGreaterThan(0);
  });
});

describe('routeLabel', () => {
  it('returns the matching route\'s short label', () => {
    expect(routeLabel('oral')).toBe('💊 ยากิน');
    expect(routeLabel('topical')).toBe('🧴 ยาทาภายนอก');
    expect(routeLabel('eye')).toBe('👁️ ยาหยอดตา');
    expect(routeLabel('ear')).toBe('👂 ยาหยอดหู');
    expect(routeLabel('inhaled')).toBe('🌬️ ยาพ่น');
    expect(routeLabel('paint')).toBe('🖌️ ยาป้าย');
  });

  it('falls back to the "other" label for undefined', () => {
    expect(routeLabel(undefined)).toBe(routeLabel('other'));
  });
});

describe('routeGroupLabel', () => {
  it('matches the short label for every route except "other"', () => {
    expect(routeGroupLabel('oral')).toBe(routeLabel('oral'));
    expect(routeGroupLabel('topical')).toBe(routeLabel('topical'));
  });

  it('is the longer "ยังไม่ระบุประเภท" wording specifically for "other"', () => {
    expect(routeGroupLabel('other')).toBe('📦 อื่นๆ / ยังไม่ระบุประเภท');
    expect(routeGroupLabel('other')).not.toBe(routeLabel('other'));
  });
});
