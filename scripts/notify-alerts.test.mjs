import { describe, it, expect, vi } from 'vitest';
import { needsReminder, bkkDayStart, reminderMessage } from './notify-hosxp-missing.mjs';
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
    await expect(alertMain({ MOPH_NOTIFY_CLIENT_KEY: 'a', MOPH_NOTIFY_SECRET_KEY: 'b' })).resolves.toBeUndefined();
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
