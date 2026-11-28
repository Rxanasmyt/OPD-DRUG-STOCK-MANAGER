// Notifications must follow Thai (Asia/Bangkok, UTC+7, no DST) time exactly.
import { describe, it, expect, vi } from 'vitest';
import { msUntilBangkokTime, waitUntilBangkokTime, bkkStartOfDay } from './moph-notify.mjs';
import { daysUntilBkk, dateLabelBkk, buildReport } from './notify-low-stock.mjs';
import { daysUntil } from '../src/utils/format';

const t = (iso) => Date.parse(iso);

describe('waiting for the exact Bangkok minute', () => {
  it('06:30 Bangkok (= 23:30 UTC the day before) waits exactly 30 minutes for 07:00', () => {
    expect(msUntilBangkokTime('07:00', t('2026-11-24T23:30:00Z'))).toBe(30 * 60000); // already Wed 25th in Bangkok
  });
  it('uses the Bangkok date: 00:10 UTC is 07:10 Bangkok, so 07:00 has passed', () => {
    expect(msUntilBangkokTime('07:00', t('2026-11-25T00:10:00Z'))).toBe(0);
  });
  it('15:00 Bangkok = 08:00 UTC', () => {
    expect(msUntilBangkokTime('15:00', t('2026-11-25T07:30:00Z'))).toBe(30 * 60000);
  });
  it('rejects malformed targets', () => {
    for (const bad of ['', 'abc', '25:00', '7', '07:60', null, undefined]) expect(msUntilBangkokTime(bad)).toBeNull();
  });
  it('sleeps for exactly the remaining time and reports it', async () => {
    const sleep = vi.fn(async () => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await waitUntilBangkokTime('07:00', { now: () => t('2026-11-24T23:30:00Z'), sleep });
    expect(sleep).toHaveBeenCalledWith(30 * 60000);
    expect(r.reason).toBe('waited');
  });
  it('a run that starts a little LATE sends immediately (no sleep)', async () => {
    const sleep = vi.fn(); vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await waitUntilBangkokTime('07:00', { now: () => t('2026-11-25T00:10:00Z'), sleep }); // 07:10 Bangkok
    expect(sleep).not.toHaveBeenCalled();
    expect(r.reason).toBe('late');
    expect(r.skip).toBeUndefined();
  });
  it('a run that starts TOO late is skipped, never sent (real case: HOSxP reminder arrived at 00:51)', async () => {
    const sleep = vi.fn(); vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await waitUntilBangkokTime('07:00', { now: () => t('2026-11-25T00:25:00Z'), sleep }); // 07:25 Bangkok
    expect(r.skip).toBe(true);
    // the 15:00 reminder that GitHub started at 00:51 the next night
    const r2 = await waitUntilBangkokTime('15:00', { now: () => t('2026-11-25T17:51:00Z'), sleep }); // 00:51 Bangkok
    expect(r2.skip).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('lateUntil: a run that GitHub starts hours late is still sent inside working hours, never at night', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const sleep = vi.fn();
    // real runs: 07:00 job started 12:16 Bangkok → sent; 15:00 job started 00:37 the next night → skipped
    const a = await waitUntilBangkokTime('07:00', { now: () => t('2026-11-27T05:16:00Z'), sleep, lateUntil: '16:30' });
    expect(a.skip).toBeUndefined(); expect(a.reason).toBe('late');
    const b = await waitUntilBangkokTime('15:00', { now: () => t('2026-11-27T17:37:00Z'), sleep, lateUntil: '16:30' });
    expect(b.skip).toBe(true);
    const c = await waitUntilBangkokTime('07:00', { now: () => t('2026-11-27T09:45:00Z'), sleep, lateUntil: '16:30' }); // 16:45 > cut-off
    expect(c.skip).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('a longer lateness limit can be allowed (monthly report)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await waitUntilBangkokTime('08:00', { now: () => t('2026-11-30T22:00:00Z'), sleep: vi.fn(), maxLateMs: 6 * 3600000 }); // 05:00 Bangkok
    expect(r.skip).toBe(true); // 3 h BEFORE target is still off schedule
    const r2 = await waitUntilBangkokTime('08:00', { now: () => t('2026-12-01T03:00:00Z'), sleep: vi.fn(), maxLateMs: 6 * 3600000 }); // 10:00, 2 h late
    expect(r2.skip).toBeUndefined();
  });
  it('never parks a job for hours: a target further than the limit is not waited for', async () => {
    const sleep = vi.fn(); vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await waitUntilBangkokTime('15:00', { now: () => t('2026-11-25T00:00:00Z'), sleep }); // 07:00 Bangkok, 8 h away
    expect(sleep).not.toHaveBeenCalled();
    expect(r.reason).toBe('too far');
    expect(r.skip).toBe(true);
  });
  it('no target (manual run) = no wait', async () => {
    const sleep = vi.fn();
    expect((await waitUntilBangkokTime('', { sleep })).reason).toBe('no target');
    expect(sleep).not.toHaveBeenCalled();
  });
  it('bkkStartOfDay is 00:00 Bangkok', () => {
    expect(new Date(bkkStartOfDay(t('2026-11-25T03:00:00Z'))).toISOString()).toBe('2026-11-24T17:00:00.000Z');
    expect(new Date(bkkStartOfDay(t('2026-11-24T17:00:00Z'))).toISOString()).toBe('2026-11-24T17:00:00.000Z');
  });
});

describe('calendar days in Thailand (same as the app)', () => {
  it('counts calendar days, not 24-hour blocks: a lot dated 1 Dec is 6 days away on the morning of 25 Nov', () => {
    const now = t('2026-11-25T00:00:00Z'); // 07:00 Bangkok, 25 Nov
    const exp = t('2026-11-30T17:00:00Z'); // 00:00 Bangkok, 1 Dec
    expect(daysUntilBkk(exp, now)).toBe(6); // the old floor((exp-now)/day) said 5
  });
  it('a lot expiring TODAY reads 0 (good through the end of its date), tomorrow reads 1, yesterday −1', () => {
    const now = t('2026-11-25T00:00:00Z');
    expect(daysUntilBkk(t('2026-11-24T17:00:00Z'), now)).toBe(0);
    expect(daysUntilBkk(t('2026-11-25T16:59:00Z'), now)).toBe(0);
    expect(daysUntilBkk(t('2026-11-25T17:00:00Z'), now)).toBe(1);
    expect(daysUntilBkk(t('2026-11-24T16:59:00Z'), now)).toBe(-1);
  });
  it('matches the app\'s daysUntil() for every hour of a day', () => {
    vi.useFakeTimers();
    try {
      for (const h of [0, 3, 12, 16, 17, 18, 23]) {
        const now = t('2026-11-25T00:00:00Z') + h * 3600000;
        vi.setSystemTime(now);
        for (const exp of [t('2026-11-25T05:00:00Z'), t('2026-11-28T10:00:00Z'), t('2026-11-30T17:00:00Z'), t('2026-11-20T03:00:00Z')]) {
          expect(daysUntilBkk(exp, now)).toBe(daysUntil(exp));
        }
      }
    } finally { vi.useRealTimers(); }
  });
  it('the expiry list in the notification uses it', () => {
    const now = t('2026-11-25T00:00:00Z');
    const med = { id: 'a', name: 'A', active: true, unit: 'เม็ด', parFloor: 10, parSub: 0, floor: 100 };
    const rep = buildReport({ meds: [med], lots: [{ medId: 'a', qty: 5, lotNo: 'L', exp: t('2026-11-30T17:00:00Z') }], now, expiryWarnDays: 30 });
    expect(rep.expiring[0].days).toBe(6);
  });
});

describe('Thai date label', () => {
  it('is the Bangkok date even when the runner clock (UTC) is still on the previous day', () => {
    expect(dateLabelBkk(t('2026-11-24T23:30:00Z'))).toContain('25 พฤศจิกายน 2569');
  });
});
