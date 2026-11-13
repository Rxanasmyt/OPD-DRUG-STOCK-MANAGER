// Regression test for a real operational bug (audit finding): this script's hand-copied
// floorMinOf() trusted ANY stored `m.floorMin`, even one left stale ABOVE the med's own
// `parFloor` (Max) — a real, reachable data state the live app explicitly guards against (see
// src/store/selectors.ts's real floorMinOf(), and AppContext.tsx's applyOnePar/
// applyAllSuggested, which both re-derive a stale floorMin whenever a par suggestion would
// otherwise leave it above the new Max). Without the `m.floorMin <= m.parFloor` guard, a med
// sitting in that stale state would get broadcast as "ต่ำกว่า Min" over LINE to real staff even
// though the app itself (using the correct, lower Min) does not consider it low.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn((x) => x),
}));

// parFloor 60 with a stale floorMin of 90 left over from when parFloor was much higher (e.g.
// 180) — floorMin > parFloor is never plausible on its own, so the correct, live Min falls back
// to halfOfMaxRounded(60)=30 (same formula as selectors.ts). floor=40 sits ABOVE that real Min,
// so this med is not actually low — but is still below the stale floorMin=90.
const STALE_MIN_MED = {
  id: 'm1', name: 'ยาทดสอบ Min ค้าง', unit: 'เม็ด', active: true, noSubstock: true,
  parFloor: 60, floorMin: 90, floor: 40, parSub: 0,
};
// A genuinely low med (no stale floorMin) — must still be caught so the fix didn't break
// real detection.
const GENUINELY_LOW_MED = {
  id: 'm2', name: 'ยาทดสอบต่ำจริง', unit: 'เม็ด', active: true, noSubstock: true,
  parFloor: 60, floor: 5, parSub: 0,
};

function mockFirestoreWith(meds) {
  vi.doMock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
      collection: (name) => {
        if (name === 'meds') return { get: async () => ({ docs: meds.map((m) => ({ id: m.id, data: () => m })) }) };
        if (name === 'lots') return { where: () => ({ get: async () => ({ docs: [] }) }) };
        throw new Error('unexpected collection: ' + name);
      },
    }),
  }));
}

describe('notify-low-stock — stale floorMin (Min above Max) regression', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'opd-drug-stock' });
    process.argv = ['node', 'notify-low-stock.mjs', '--dry-run'];
  });

  it('does not flag a med whose stored floorMin is stale/above parFloor as below Min', async () => {
    mockFirestoreWith([STALE_MIN_MED]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { main } = await import('./notify-low-stock.mjs');
    await main();

    // Without the fix, floor=40 < stale floorMin=50 would be (wrongly) flagged "ต่ำกว่า Min".
    // With the fix, the real Min is halfOfMaxRounded(60)=30, and floor=40 is not below that, so
    // nothing in this single-med fixture is low at all.
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Nothing below par today'))).toBe(true);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('(Min)'))).toBe(false);
    logSpy.mockRestore();
  });

  it('still flags a genuinely low med (no stale floorMin) as below Min', async () => {
    mockFirestoreWith([GENUINELY_LOW_MED]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { main } = await import('./notify-low-stock.mjs');
    await main();

    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('(Min)');
    expect(printed).toContain(GENUINELY_LOW_MED.name);
    logSpy.mockRestore();
  });
});
