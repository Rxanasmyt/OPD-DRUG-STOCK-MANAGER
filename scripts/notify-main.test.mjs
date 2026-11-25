// End-to-end runs of the two scheduled scripts' main() against a mocked Firestore + fetch — catches runtime slips in the parts the
// pure-function tests don't reach (query chain, env handling, exit paths).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn((x) => x) }));

function mockDb({ txs = [], returns = [] } = {}) {
  const calls = { txs: [], returns: [] };
  vi.doMock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
      collection: (name) => {
        const chain = { _f: [], where(f, op, v) { this._f.push([f, op, v]); calls[name]?.push(['where', f, op, v]); return this; }, orderBy(f, d) { calls[name]?.push(['orderBy', f, d]); return this; },
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
    expect(calls.txs).toEqual([['where', 'ts', '>=', Date.parse('2026-11-24T17:00:00Z')]]);
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
  it('reads a 6-month window with a single-field date range and sends one carousel', async () => {
    const calls = mockDb({ returns: [r({}), r({ date: '2026-09-05', id: 'p' })] });
    const f = fetchOk(); vi.stubGlobal('fetch', f);
    const { main } = await import('./notify-monthly-returns.mjs');
    await main();
    expect(calls.returns).toEqual([['where', 'date', '>=', '2026-05-01'], ['where', 'date', '<=', '2026-10-31'], ['orderBy', 'date', 'asc']]);
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
