// End-to-end runs of the two scheduled scripts' main() against a mocked Firestore + fetch — catches runtime slips in the parts the
// pure-function tests don't reach (query chain, env handling, exit paths).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn((x) => x) }));

function mockDb({ txs = [], returns = [] } = {}) {
  const calls = { txs: [], returns: [], stamps: [] };
  vi.doMock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
      doc: (path) => ({ set: async (d, o) => { calls.stamps.push([path, d, o]); }, get: async () => ({ data: () => ({}) }) }),
      collection: (name) => {
        const chain = { _f: [], where(f, op, v) { this._f.push([f, op, v]); calls[name]?.push(['where', f, op, v]); return this; }, orderBy(f, d) { calls[name]?.push(['orderBy', f, d]); return this; },
          limit(n) { calls[name]?.push(['limit', n]); return this; },
          get: async () => ({ docs: (name === 'txs' ? txs : returns).map((r, i) => ({ id: r.id ?? 'd' + i, data: () => r })) }) };
        return chain;
      },
    }),
  }));
  return calls;
}
const fetchOk = () => vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"message":"Success","message_code":200}' }));

describe('notify-hosxp-missing main()', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'p' });
    process.env.MOPH_NOTIFY_CLIENT_KEY = 'ck'; process.env.MOPH_NOTIFY_SECRET_KEY = 'sk';
    delete process.env.HOLIDAYS;
    process.argv = ['node', 'x'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T08:00:00Z')); // Wed 15:00 Bangkok
  });
  it('queries only today (single-field ts range) and sends when no reconcile happened', async () => {
    const calls = mockDb({ txs: [{ type: 'transfer', ts: Date.now() - 3600000 }] });
    const f = fetchOk(); vi.stubGlobal('fetch', f);
    const { main } = await import('./notify-hosxp-missing.mjs');
    await main();
    expect(calls.txs[0]).toEqual(['where', 'ts', '>=', Date.parse('2026-11-24T17:00:00Z')]); // today only, single-field range
    expect(calls.txs.slice(1)).toEqual([['orderBy', 'coveredTo', 'desc'], ['limit', 1]]); // + ONE read for the last covered date
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it('sends nothing when the reconcile is done', async () => {
    mockDb({ txs: [{ type: 'reconcile_hosxp', ts: Date.now() - 3600000 }] });
    const f = fetchOk(); vi.stubGlobal('fetch', f);
    const { main } = await import('./notify-hosxp-missing.mjs');
    await main();
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('FAILS (red run) when a reminder is due but the MOPH keys are missing', async () => {
    delete process.env.MOPH_NOTIFY_CLIENT_KEY;
    mockDb({ txs: [] });
    const { main } = await import('./notify-hosxp-missing.mjs');
    await expect(main()).rejects.toThrow(/not set/);
  });
});

describe('notify-monthly-returns main()', () => {
  beforeEach(() => {
    vi.resetModules(); vi.useRealTimers();
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'p' });
    process.env.MOPH_NOTIFY_CLIENT_KEY = 'ck'; process.env.MOPH_NOTIFY_SECRET_KEY = 'sk';
    process.argv = ['node', 'x', '--month=2026-10'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  const r = (o) => ({ medId: 'm', medName: 'ยา', unit: 'เม็ด', category: 'pain', hn: '1', qty: 1, value: 100, reason: 'ปรับเปลี่ยนการรักษา', note: '', date: '2026-10-05', ts: 1, ...o });
  it('reads a 13-month window (trend + previous month + same month last year) with a single-field date range and sends one carousel', async () => {
    const calls = mockDb({ returns: [r({}), r({ date: '2026-09-05', id: 'p' })] });
    const f = fetchOk(); vi.stubGlobal('fetch', f);
    const { main } = await import('./notify-monthly-returns.mjs');
    await main();
    expect(calls.returns).toEqual([['where', 'date', '>=', '2025-10-01'], ['where', 'date', '<=', '2026-10-31'], ['orderBy', 'date', 'asc']]);
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].contents.type).toBe('carousel');
    vi.unstubAllGlobals();
  });
  it('--dry-run sends nothing; a bad --month exits', async () => {
    mockDb({ returns: [] });
    const f = fetchOk(); vi.stubGlobal('fetch', f);
    process.argv = ['node', 'x', '--month=2026-10', '--dry-run'];
    const { main } = await import('./notify-monthly-returns.mjs');
    await main();
    expect(f).not.toHaveBeenCalled();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    process.argv = ['node', 'x', '--month=2026-13'];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('exit');
    exit.mockRestore(); vi.unstubAllGlobals();
  });
  it('without --month it reports the previous Bangkok month', async () => {
    process.argv = ['node', 'x']; delete process.env.REPORT_MONTH;
    mockDb({ returns: [] });
    vi.stubGlobal('fetch', fetchOk());
    const { main, previousMonthOf } = await import('./notify-monthly-returns.mjs');
    await main();
    expect(previousMonthOf(Date.now())).toMatch(/^\d{4}-\d{2}$/);
    vi.unstubAllGlobals();
  });
});

describe('scheduled runs wait for the exact Bangkok minute BEFORE reading data', () => {
  it('hosxp reminder started at 14:30 Bangkok reads Firestore and sends only at 15:00', async () => {
    vi.resetModules();
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'p' });
    process.env.MOPH_NOTIFY_CLIENT_KEY = 'ck'; process.env.MOPH_NOTIFY_SECRET_KEY = 'sk';
    process.env.TARGET_TIME_BKK = '15:00'; delete process.env.HOLIDAYS;
    process.argv = ['node', 'x'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T07:30:00Z')); // Wed 14:30 Bangkok
    const calls = mockDb({ txs: [] });
    const f = fetchOk(); vi.stubGlobal('fetch', f);
    const { main } = await import('./notify-hosxp-missing.mjs');
    const done = main();
    await vi.advanceTimersByTimeAsync(29 * 60000);
    expect(calls.txs).toEqual([]);      // still waiting: nothing read, nothing sent
    expect(f).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000 + 1000);
    await done;
    expect(f).toHaveBeenCalledTimes(1);  // sent at 15:00
    expect(new Date(calls.txs[0][3]).toISOString()).toBe('2026-11-24T17:00:00.000Z'); // "today" is the Bangkok day
    delete process.env.TARGET_TIME_BKK;
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
});

describe('run health stamps (meta/notifyStatus)', () => {
  beforeEach(() => {
    vi.resetModules(); vi.useRealTimers();
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'p' });
    process.env.MOPH_NOTIFY_CLIENT_KEY = 'ck'; process.env.MOPH_NOTIFY_SECRET_KEY = 'sk';
    delete process.env.TARGET_TIME_BKK; delete process.env.REMINDER_ROUND; delete process.env.HOLIDAYS;
    process.argv = ['node', 'x'];
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  const WED = new Date('2026-11-25T08:00:00Z');

  it('hosxp: a reminder that was sent is stamped "sent" with the outstanding days; a clean day is stamped "nothing" (ran, nothing to say)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(WED);
    let calls = mockDb({ txs: [{ type: 'reconcile_hosxp', ts: Date.now() - 3600000, coveredTo: '2026-11-24' }] });
    vi.stubGlobal('fetch', fetchOk());
    let { main } = await import('./notify-hosxp-missing.mjs');
    await main();
    expect(calls.stamps[0][0]).toBe('meta/notifyStatus');
    expect(calls.stamps[0][1].hosxp).toMatchObject({ result: 'nothing', why: 'already-reconciled' });
    vi.resetModules();
    calls = mockDb({ txs: [{ type: 'transfer', ts: Date.now() - 3600000, coveredTo: '2026-11-20' }] }); // last covered Fri 20th → Mon 23rd & Tue 24th missing
    ({ main } = await import('./notify-hosxp-missing.mjs'));
    await main();
    expect(calls.stamps[0][1].hosxp).toMatchObject({ result: 'sent', round: 1, missingDays: 2 });
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it('hosxp: a failure is stamped "failed" (and still fails the run)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(WED);
    delete process.env.MOPH_NOTIFY_CLIENT_KEY;
    const calls = mockDb({ txs: [] });
    const { main } = await import('./notify-hosxp-missing.mjs');
    await expect(main()).rejects.toThrow(/not set/);
    expect(calls.stamps[0][1].hosxp.result).toBe('failed');
    vi.useRealTimers();
  });
  it('--dry-run never writes a stamp', async () => {
    vi.useFakeTimers(); vi.setSystemTime(WED);
    process.argv = ['node', 'x', '--dry-run'];
    const calls = mockDb({ txs: [] });
    const { main } = await import('./notify-hosxp-missing.mjs');
    await main();
    expect(calls.stamps).toEqual([]);
    vi.useRealTimers();
  });
  it('monthly report: stamped "sent" with its month', async () => {
    process.argv = ['node', 'x', '--month=2026-10'];
    const calls = mockDb({ returns: [] });
    vi.stubGlobal('fetch', fetchOk());
    const { main } = await import('./notify-monthly-returns.mjs');
    await main();
    expect(calls.stamps[0][1].monthly).toMatchObject({ result: 'sent', month: '2026-10' });
    vi.unstubAllGlobals();
  });
});
