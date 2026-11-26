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
