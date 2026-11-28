import { describe, it, expect, vi } from 'vitest';
import { needsReminder, bkkDayStart, reminderMessage, missingWorkdays } from './notify-hosxp-missing.mjs';
import { buildAlert, main as alertMain } from './notify-alert.mjs';
import { mophNotify, alertFlex } from './moph-notify.mjs';

// Wed 2026-11-25 08:00 UTC = 15:00 Bangkok
const WED = Date.parse('2026-11-25T08:00:00Z');
const SAT = Date.parse('2026-11-28T08:00:00Z');

describe('HOSxP reminder decision', () => {
  it('reminds on a weekday with no reconcile today', () => {
    expect(needsReminder({ txs: [{ type: 'transfer', ts: WED - 3600000 }], now: WED }).remind).toBe(true);
  });
  it('is silent when a reconcile_hosxp tx exists today (Bangkok date)', () => {
    expect(needsReminder({ txs: [{ type: 'reconcile_hosxp', ts: WED - 3600000 }], now: WED }).reason).toBe('already-reconciled');
  });
  it('a reconcile from YESTERDAY does not count', () => {
    expect(needsReminder({ txs: [{ type: 'reconcile_hosxp', ts: WED - 26 * 3600000 }], now: WED }).remind).toBe(true);
  });
  it('uses the Bangkok date: 20:00 UTC the day before is already "today" in Bangkok', () => {
    const justAfterMidnightBkk = Date.parse('2026-11-24T18:00:00Z'); // 01:00 on the 25th in Bangkok
    expect(needsReminder({ txs: [{ type: 'reconcile_hosxp', ts: justAfterMidnightBkk }], now: WED }).remind).toBe(false);
  });
  it('is silent on weekends and listed holidays', () => {
    expect(needsReminder({ txs: [], now: SAT }).reason).toBe('weekend');
    expect(needsReminder({ txs: [], now: WED, holidays: ['2026-11-25'] }).reason).toBe('holiday');
  });
  it('a malformed tx with no ts does not crash the check', () => {
    expect(() => needsReminder({ txs: [{ type: 'reconcile_hosxp' }, { type: 'reconcile_hosxp', ts: 'x' }], now: WED })).not.toThrow();
    expect(needsReminder({ txs: [{ type: 'reconcile_hosxp' }], now: WED }).remind).toBe(true);
  });
  it('bkkDayStart is 00:00 Bangkok = 17:00 UTC the previous day', () => {
    expect(new Date(bkkDayStart(WED)).toISOString()).toBe('2026-11-24T17:00:00.000Z');
  });
  it('message names the problem and carries the app button', () => {
    const m = reminderMessage(WED);
    expect(JSON.stringify(m)).toContain('ยังไม่ได้ตัดยอด HOSxP');
    expect(m.contents.footer.contents[0].action.uri).toContain('OPD-DRUG-STOCK-MANAGER');
  });
});

describe('failure alert', () => {
  it('builds a red card with the run link as its button', () => {
    const m = buildAlert({ ALERT_TITLE: 'สำรองข้อมูลล้มเหลว', ALERT_RUN_URL: 'https://github.com/x/y/actions/runs/1' });
    expect(m.altText).toContain('สำรองข้อมูลล้มเหลว');
    expect(m.contents.footer.contents[0].action.uri).toBe('https://github.com/x/y/actions/runs/1');
  });
  it('never throws even when MOPH rejects (must not hide the original failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"message_code":401}' })));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(alertMain({ MOPH_NOTIFY_CLIENT_KEY: 'a', MOPH_NOTIFY_SECRET_KEY: 'b', ALERT_IGNORE_HOURS: '1' })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    vi.unstubAllGlobals(); err.mockRestore();
  });
  it('without keys it only logs and sends nothing', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await alertMain({});
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('shared MOPH helper', () => {
  it('mophNotify treats message_code 401 as failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"message_code":401}' })));
    await expect(mophNotify('a', 'b', [alertFlex({ icon: 'x', title: 't', lines: ['l'] })])).rejects.toThrow(/MOPH Notify failed/);
    vi.unstubAllGlobals();
  });
});

describe('required keys (a scheduled report that silently sends nothing must fail the run)', () => {
  it('sendIfConfigured({required}) throws without keys, but stays optional for failure alerts', async () => {
    const { sendIfConfigured } = await import('./moph-notify.mjs');
    await expect(sendIfConfigured([], {}, { required: true })).rejects.toThrow(/not set/);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(sendIfConfigured([], {})).resolves.toBe(false);
  });
});

describe('outstanding working days (same rule as the app banner)', () => {
  const TUE = Date.parse('2026-11-24T08:00:00Z'); // Tue 24 Nov, 15:00 Bangkok
  it('nothing outstanding when yesterday is covered', () => { expect(missingWorkdays('2026-11-23', TUE).n).toBe(0); });
  it('Friday\'s file then Tuesday afternoon: Mon (and Tue\'s own file is for yesterday = Mon) → 1 working day', () => {
    expect(missingWorkdays('2026-11-20', TUE)).toEqual({ n: 1, first: '2026-11-23', last: '2026-11-23' });
  });
  it('a week without files skips the weekend', () => {
    const r = missingWorkdays('2026-11-13', TUE); // covered Fri 13th → Mon 16 … Mon 23 = 6 working days
    expect(r).toMatchObject({ n: 6, first: '2026-11-16', last: '2026-11-23' });
  });
  it('listed holidays do not count as missed days', () => {
    expect(missingWorkdays('2026-11-13', TUE, ['2026-11-16', '2026-11-17']).n).toBe(4);
  });
  it('no information → 0 (never claims a delay it cannot prove)', () => { expect(missingWorkdays(null, TUE).n).toBe(0); });
});

describe('reminder wording', () => {
  const NOW = Date.parse('2026-11-24T08:00:00Z');
  const text = (m) => JSON.stringify(m);
  it('round 1 with one day outstanding is the calm orange card', () => {
    const m = reminderMessage(NOW, { round: 1, missing: { n: 1, first: '2026-11-23', last: '2026-11-23' } });
    expect(text(m)).toContain('วันนี้ยังไม่ได้ตัดยอด HOSxP');
    expect(text(m)).not.toContain('วันทำการ');
  });
  it('2+ working days outstanding is escalated: red, count in the title and the date range', () => {
    const m = reminderMessage(NOW, { round: 1, missing: { n: 3, first: '2026-11-19', last: '2026-11-23' } });
    expect(text(m)).toContain('ยังไม่ได้ตัดยอด HOSxP 3 วันทำการ');
    expect(text(m)).toContain('19 พ.ย. – 23 พ.ย.');
    expect(text(m)).toContain('#B71C1C'); // red tone
  });
  it('round 2 says it is the second reminder', () => {
    const m = reminderMessage(Date.parse('2026-11-24T09:30:00Z'), { round: 2 });
    expect(text(m)).toContain('เตือนครั้งที่ 2');
    expect(text(m)).toContain('16:30');
  });
});

describe('stampRun replaces the job entry instead of deep-merging it', () => {
  it('uses mergeFields: [kind] so a stale error from an earlier failed run cannot linger', async () => {
    const { stampRun } = await import('./moph-notify.mjs');
    const set = vi.fn(async () => {});
    await stampRun({ doc: () => ({ set }) }, 'stock', 'sent', { items: 3 });
    expect(set).toHaveBeenCalledTimes(1);
    const [data, opts] = set.mock.calls[0];
    expect(opts).toEqual({ mergeFields: ['stock'] });
    expect(data.stock).toMatchObject({ result: 'sent', items: 3 });
    expect(data.stock.error).toBeUndefined();
  });
  it('never throws (a stamp failure must not hide the real outcome)', async () => {
    const { stampRun } = await import('./moph-notify.mjs');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(stampRun({ doc: () => ({ set: async () => { throw new Error('denied'); } }) }, 'stock', 'sent')).resolves.toBeUndefined();
  });
});

describe('needsReminder is silent outside working hours', () => {
  it('00:51 Bangkok on a weekday (real case) → no reminder; 15:00 → reminder', async () => {
    const { needsReminder } = await import('./notify-hosxp-missing.mjs');
    const at = (iso) => Date.parse(iso);
    expect(needsReminder({ txs: [], now: at('2026-11-25T17:51:00Z') }).reason).toBe('off-hours'); // Thu 26 Nov 00:51
    expect(needsReminder({ txs: [], now: at('2026-11-26T08:00:00Z') }).remind).toBe(true); // 15:00
    expect(needsReminder({ txs: [], now: at('2026-11-26T14:00:00Z') }).reason).toBe('off-hours'); // 21:00
    expect(needsReminder({ txs: [], now: at('2026-11-26T09:45:00Z') }).reason).toBe('off-hours'); // 16:45
    expect(needsReminder({ txs: [], now: at('2026-11-26T12:00:00Z') }).reason).toBe('off-hours'); // 19:00
  });
});

describe('office hours (Mon–Fri 08:30–16:30 Bangkok)', () => {
  it('inOfficeHours boundaries', async () => {
    const { inOfficeHours } = await import('./moph-notify.mjs');
    const at = (iso) => Date.parse(iso);
    expect(inOfficeHours(at('2026-11-26T01:30:00Z'))).toBe(true); // Thu 08:30
    expect(inOfficeHours(at('2026-11-26T01:29:00Z'))).toBe(false); // 08:29
    expect(inOfficeHours(at('2026-11-26T09:30:00Z'))).toBe(true); // 16:30
    expect(inOfficeHours(at('2026-11-26T09:31:00Z'))).toBe(false); // 16:31
    expect(inOfficeHours(at('2026-11-28T05:00:00Z'))).toBe(false); // Saturday noon
  });
  it('the failure alert is NOT sent at night (02:00) and IS sent in office hours', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"message_code":200}' }));
    vi.stubGlobal('fetch', f); vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T19:00:00Z')); // Thu 02:00 Bangkok
    await alertMain({ MOPH_NOTIFY_CLIENT_KEY: 'a', MOPH_NOTIFY_SECRET_KEY: 'b' });
    expect(f).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-11-26T03:00:00Z')); // Thu 10:00 Bangkok
    await alertMain({ MOPH_NOTIFY_CLIENT_KEY: 'a', MOPH_NOTIFY_SECRET_KEY: 'b' });
    expect(f).toHaveBeenCalledTimes(1);
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it('monthly report: only on the first Mon–Fri of the month', async () => {
    const { isFirstWeekdayOfMonth } = await import('./notify-monthly-returns.mjs');
    const d = (iso) => Date.parse(iso + 'T03:00:00Z');
    expect(isFirstWeekdayOfMonth(d('2026-12-01'))).toBe(true); // Tue
    expect(isFirstWeekdayOfMonth(d('2026-12-02'))).toBe(false);
    expect(isFirstWeekdayOfMonth(d('2027-05-01'))).toBe(false); // Sat
    expect(isFirstWeekdayOfMonth(d('2027-05-03'))).toBe(true); // Mon (1st was Sat)
    expect(isFirstWeekdayOfMonth(d('2027-08-02'))).toBe(true); // Mon (1st was Sun)
    expect(isFirstWeekdayOfMonth(d('2027-08-03'))).toBe(false);
  });
});
