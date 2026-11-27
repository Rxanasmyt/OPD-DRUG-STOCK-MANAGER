// Thai time must not depend on the device's own timezone (a tablet that lost its settings, a phone set to another region).
import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { thDate, thDateLong, thTime, bangkokHour, bangkokWeekday, isoDate } from './format';

const realTZ = process.env.TZ;
afterEach(() => { if (realTZ === undefined) delete process.env.TZ; else process.env.TZ = realTZ; });

// 01:00 on Wed 25 Nov 2026 in Bangkok = 18:00 UTC on Tue 24 Nov = 10:00 Tue 24 Nov in Los Angeles
const MS = Date.UTC(2026, 10, 24, 18, 0, 0);

describe('display formats follow Bangkok, not the device', () => {
  for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo', 'Pacific/Honolulu']) {
    it(`device in ${tz}`, () => {
      process.env.TZ = tz;
      expect(thDate(MS)).toContain('25');
      expect(thDateLong(MS)).toContain('25');
      expect(thTime(MS)).toMatch(/^0?1[:.]00/);
      expect(bangkokHour(MS)).toBe(1);
      expect(bangkokWeekday(MS)).toBe(3); // Wednesday
      expect(isoDate(MS)).toBe('2026-11-25');
    });
  }
});

describe('no screen reads the device clock for "what day / hour is it in Thailand"', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p); } };
  walk('src');
  it('no new Date().getDay()/getHours() or now.getHours()', () => {
    const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const bad = files.filter((f) => /new Date\(\)\.(getDay|getHours)\(\)|\bnow\.getHours\(\)/.test(code(f)));
    expect(bad).toEqual([]);
  });
});

describe('every toLocale*String with a date in src passes an explicit timeZone', () => {
  it('print/format helpers never rely on the device zone', () => {
    const walk2: string[] = [];
    const w = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) walk2.push(p); } };
    w('src');
    const bad: string[] = [];
    for (const f of walk2) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
        if (/toLocale(Date|Time)?String\(\s*'th-TH'\s*,\s*\{[^}]*(dateStyle|timeStyle|day:|month:|hour:)/.test(l) && !/timeZone/.test(l)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('date-only ISO strings are anchored to Bangkok, not the device', () => {
  it('no "YYYY-MM-DD"+T00:00:00 / T12:00:00 / T23:59:59.999 without an offset in src or scripts', () => {
    const all: string[] = [];
    const w = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else if (/\.(ts|tsx|mjs)$/.test(f) && !/\.test\./.test(f)) all.push(p); } };
    w('src'); w('scripts');
    const bad: string[] = [];
    for (const f of all) readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (/T(00:00:00|23:59:59\.999|12:00:00)'/.test(l) && !/(Z'|\+07:00')/.test(l)) bad.push(`${f}:${i + 1}`);
    });
    expect(bad).toEqual([]);
  });

  for (const tz of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
    it(`reconcileReminder counts the same missing days on a device in ${tz}`, async () => {
      process.env.TZ = tz;
      const { reconcileReminder } = await import('../store/selectors');
      // Thu 26 Nov 2026 10:00 Bangkok; last file covered Mon 23 Nov → Tue 24 + Wed 25 missing
      const r = reconcileReminder('2026-11-23', Date.UTC(2026, 10, 26, 3, 0, 0));
      expect(r.level).toBe('overdue');
      expect(r.missingWeekdays).toBe(2);
      expect(r.firstMissingIso).toBe('2026-11-24');
      expect(r.lastMissingIso).toBe('2026-11-25');
    });
  }
});
