// Regression test for a real operational bug (audit finding): this script's hand-copied
// floorMinOf() trusted ANY stored `m.floorMin`, even one left stale ABOVE the med's own
// `parFloor` (Max) — a real, reachable data state the live app explicitly guards against (see
// src/store/selectors.ts's real floorMinOf(), and AppContext.tsx's applyOnePar/
// applyAllSuggested, which both re-derive a stale floorMin whenever a par suggestion would
// otherwise leave it above the new Max). Without the `m.floorMin <= m.parFloor` guard, a med
// sitting in that stale state would get broadcast as "ต่ำกว่า Min" over LINE to real staff even
// though the app itself (using the correct, lower Min) does not consider it low.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildReport, buildText, buildFlex, urgencyLevel } from './notify-low-stock.mjs';

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
      doc: () => ({ get: async () => ({ data: () => ({ expiryWarnDays: 30 }) }) }),
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
    // With the fix, the real Min is halfOfMaxRounded(60)=30, and floor=40 is not below that.
    // (This no-substock fixture is below its parFloor, so it may still appear in the separate
    // "ควรเบิกจากคลังใหญ่" section — what matters here is that it is NOT flagged below Min.)
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

  it('never lists a med flagged "ยาขาดชั่วคราว" (stock hold), matching the app\'s own low-stock lists', async () => {
    mockFirestoreWith([{ ...GENUINELY_LOW_MED, outOfStockSince: Date.now() }]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { main } = await import('./notify-low-stock.mjs');
    await main();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Nothing below par today'))).toBe(true);
    logSpy.mockRestore();
  });

  it('judges a no-substock med against parFloor for the warehouse-request section, like needsWarehouseRequest()', async () => {
    // floor 40 is above its Min (30) so not "below Min", but below parFloor 60 -> needs requesting.
    mockFirestoreWith([{ ...STALE_MIN_MED, floorMin: undefined }]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { main } = await import('./notify-low-stock.mjs');
    await main();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('ควรเบิกจากคลังใหญ่');
    expect(printed).not.toContain('(Min)');
    logSpy.mockRestore();
  });
});

describe('notify-low-stock — MOPH Notify channel', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'opd-drug-stock' });
    process.argv = ['node', 'notify-low-stock.mjs'];
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    process.env.MOPH_NOTIFY_CLIENT_KEY = 'ck';
    process.env.MOPH_NOTIFY_SECRET_KEY = 'sk';
  });

  it('posts the text message to the MOPH endpoint with client-key/secret-key headers', async () => {
    mockFirestoreWith([GENUINELY_LOW_MED]);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"message":"Success","message_code":200}' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { main } = await import('./notify-low-stock.mjs');
    await main();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://morpromt2f.moph.go.th/api/notify/send');
    expect(init.headers['client-key']).toBe('ck');
    expect(init.headers['secret-key']).toBe('sk');
    const body = JSON.parse(init.body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].type).toBe('flex');
    expect(body.messages[0].altText).toContain('แจ้งเตือนสต็อกยา');
    expect(JSON.stringify(body.messages[0])).toContain(GENUINELY_LOW_MED.name);
    vi.unstubAllGlobals();
  });

  it('treats message_code 401 in the body as a failure even when HTTP is 200', async () => {
    mockFirestoreWith([GENUINELY_LOW_MED]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"message":"Unauthorized","message_code":401}' })));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { main } = await import('./notify-low-stock.mjs');
    await expect(main()).rejects.toThrow(/MOPH Notify failed/);
    vi.unstubAllGlobals();
  });

  it('a failing MOPH channel does not stop the LINE OA channel from sending', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
    mockFirestoreWith([GENUINELY_LOW_MED]);
    const fetchMock = vi.fn(async (url) => String(url).includes('moph')
      ? { ok: false, status: 500, text: async () => 'boom' }
      : { ok: true, status: 200, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { main } = await import('./notify-low-stock.mjs');
    await expect(main()).rejects.toThrow(/1 notification channel/);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('api.line.me'))).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('notify-low-stock — report sections', () => {
  const NOW = Date.parse('2026-11-25T03:00:00Z');
  const base = { active: true, unit: 'เม็ด', parFloor: 100, parSub: 0, noSubstock: true };
  const meds = [
    { ...base, id: 'z', name: 'ZERO DRUG', floor: 0 },
    { ...base, id: 'zc', name: 'ZERO COUNTED TODAY', floor: 0, lastCountTs: NOW - 3600000 },
    { ...base, id: 'ok', name: 'OK DRUG', floor: 90 },
  ];
  const lots = [
    { id: 'a', medId: 'ok', qty: 5, lotNo: 'L1', exp: NOW + 10 * 86400000 },
    { id: 'b', medId: 'ok', qty: 5, lotNo: 'L2', exp: NOW + 200 * 86400000 },
    { id: 'c', medId: 'ok', qty: 7, lotNo: 'ปรับยอด (นับสต็อก)', exp: NOW + 100 * 365 * 86400000 },
    { id: 'd', medId: 'ok', qty: 0, lotNo: 'L0', exp: NOW + 1 * 86400000 },
  ];
  const r = buildReport({ meds, lots, expiryWarnDays: 30, now: NOW });

  it('lists a zero-floor med that was not counted today, and skips one counted today', () => {
    expect(r.zeroFloor.map((x) => x.name)).toEqual(['ZERO DRUG']);
  });
  it('does not repeat a zero-floor med under "ต่ำกว่า Min"', () => {
    expect(r.belowMin.map((x) => x.name)).not.toContain('ZERO DRUG');
  });
  it('lists only real lots expiring inside the warn window (not far-dated, empty, or placeholder lots)', () => {
    expect(r.expiring).toHaveLength(1);
    expect(r.expiring[0]).toMatchObject({ lotNo: 'L1', days: 10 });
  });
  it('text and flex both carry every section and the app link', () => {
    const label = 'วันพุธ';
    const text = buildText(r, label);
    expect(text).toContain('ยอดหน้างานเป็น 0');
    expect(text).toContain('ใกล้หมดอายุ');
    const flex = buildFlex(r, label);
    expect(flex.type).toBe('flex');
    expect(JSON.stringify(flex)).toContain('ZERO DRUG');
    expect(flex.contents.type).toBe('carousel');
    const bubbles = flex.contents.contents;
    expect(bubbles.length).toBe(1 + 4); // summary + Min (the already-counted zero med) + zero + par + expiring
    expect(bubbles[0].footer.contents[0].action.uri).toContain('OPD-DRUG-STOCK-MANAGER');
    expect(bubbles.length).toBeLessThanOrEqual(12); // LINE carousel limit
  });
  it('is empty when nothing needs attention', () => {
    expect(buildReport({ meds: [{ ...base, id: 'ok', name: 'OK', floor: 100 }], lots: [], now: NOW }).empty).toBe(true);
  });
});

describe('notify-low-stock — flex payload stays within LINE limits', () => {
  it('caps rows per card and stays small even with hundreds of alerts', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ name: 'ยา ' + i, unit: 'เม็ด', cur: i % 7, ref: 50 }));
    const rep = { emergency: many.map((m) => ({ name: m.name, unit: m.unit, onHand: 5, cover: 2, level: urgencyLevel(2), needQty: 100 })), horizonDays: 14, belowMin: many, belowSubPar: many, zeroFloor: many.map((m) => ({ name: m.name, unit: m.unit })), expiring: many.map((m) => ({ ...m, lotNo: 'L', qty: 1, days: 3 })), expiryWarnDays: 30, empty: false };
    const flex = buildFlex(rep, 'วันนี้');
    expect(flex.contents.contents.length).toBe(6);
    expect(JSON.stringify(flex).length).toBeLessThan(30000); // LINE flex payload: stay under 30KB by shrinking rows per card
    expect(flex.altText.length).toBeLessThanOrEqual(400);
  });
});

describe('notify-low-stock — emergency requisition (runs out before next delivery)', () => {
  const NOW = Date.parse('2026-11-25T03:00:00Z');
  const base = { active: true, unit: 'เม็ด', parFloor: 100, parSub: 1000, used30: 900, usedPrev30: 0 }; // 30/day
  const meds = [
    { ...base, id: 'a', name: 'RUNS OUT SOON', floor: 20 },        // 20 + 100 = 120 on hand → 4 days
    { ...base, id: 'b', name: 'PLENTY', floor: 100 },              // 100 + 900 = 1000 → 33 days
    { ...base, id: 'c', name: 'ON HOLD', floor: 0, outOfStockSince: NOW },
    { ...base, id: 'd', name: 'NO USAGE', floor: 0, used30: 0 },
  ];
  const lots = [{ medId: 'a', qty: 100, exp: NOW + 400 * 86400000 }, { medId: 'b', qty: 900, exp: NOW + 400 * 86400000 }];

  it('flags only drugs whose total on-hand runs out inside the horizon, soonest first', () => {
    const r = buildReport({ meds, lots, now: NOW, horizonDays: 7 });
    expect(r.emergency.map((e) => e.name)).toEqual(['RUNS OUT SOON']);
    expect(r.emergency[0].cover).toBe(4);
  });
  it('suggests a request quantity that covers horizon + lead time (at least up to par)', () => {
    const r = buildReport({ meds, lots, now: NOW, horizonDays: 7 });
    expect(r.emergency[0].needQty).toBe(Math.max(30 * 14 - 120, 1000 - 100)); // 900
  });
  it('a nearer next-delivery date shrinks the horizon', () => {
    expect(buildReport({ meds, lots, now: NOW, horizonDays: 3 }).emergency).toHaveLength(0);
  });
  it('an emergency drug is not repeated under "ต่ำกว่า par", and shows first in the flex carousel', () => {
    const r = buildReport({ meds, lots, now: NOW, horizonDays: 7 });
    expect(r.belowSubPar.map((x) => x.name)).not.toContain('RUNS OUT SOON');
    const flex = buildFlex(r, 'วันนี้');
    expect(JSON.stringify(flex.contents.contents[1])).toContain('เบิกฉุกเฉิน');
    expect(buildText(r, 'วันนี้')).toContain('🚨');
  });
});

describe('notify-low-stock — emergency urgency levels', () => {
  const NOW = Date.parse('2026-11-25T03:00:00Z');
  const mk = (id, name, onHand) => ({ id, name, active: true, unit: 'เม็ด', parFloor: 10, parSub: 0, noSubstock: true, used30: 300, usedPrev30: 0, floor: onHand }); // 10/day
  it('ladders by days of cover: ≤1 วิกฤต, 2–3 เร่งด่วนมาก, 4–7 เร่งด่วน; >7 days is not flagged', () => {
    const r = buildReport({ meds: [mk('a', 'D0', 5), mk('b', 'D2', 25), mk('c', 'D5', 55), mk('d', 'D7', 70), mk('e', 'D9', 95)], lots: [], now: NOW });
    expect(r.horizonDays).toBe(7);
    expect(r.emergency.map((e) => [e.name, e.level.label])).toEqual([
      ['D0', 'วิกฤต'], ['D2', 'เร่งด่วนมาก'], ['D5', 'เร่งด่วน'], ['D7', 'เร่งด่วน'],
    ]);
  });
  it('level labels appear in the text and the flex summary', () => {
    const r = buildReport({ meds: [mk('a', 'D0', 5), mk('b', 'D2', 25)], lots: [], now: NOW });
    expect(buildText(r, 'x')).toContain('วิกฤต');
    expect(JSON.stringify(buildFlex(r, 'x'))).toContain('เร่งด่วนมาก');
  });
});

describe('notify-low-stock — bug fixes found in review', () => {
  const NOW = Date.parse('2026-11-25T03:00:00Z');
  it('two meds with the SAME name (e.g. OPD + IPD record) are told apart by id when de-duplicating sections', () => {
    const a = { id: 'opd', name: 'SAME NAME', active: true, unit: 'เม็ด', parFloor: 10, parSub: 0, noSubstock: true, used30: 300, floor: 5 };   // runs out → emergency
    const b = { id: 'ipd', name: 'SAME NAME', active: true, unit: 'เม็ด', parFloor: 100, parSub: 0, noSubstock: true, used30: 0, floor: 20 }; // below par, no usage
    const r = buildReport({ meds: [a, b], lots: [], now: NOW });
    expect(r.emergency.map((e) => e.id)).toEqual(['opd']);
    expect(r.belowSubPar.map((e) => e.id)).toEqual(['ipd']); // used to vanish: filtered out by the shared NAME
  });
  it('plain-text message never exceeds LINE\'s 5,000-character limit and keeps the app link', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: 'i' + i, name: 'ยาชื่อยาวมากมาย '.repeat(6) + i, unit: 'เม็ด', cur: 1, ref: 50 }));
    const rep = { emergency: [], horizonDays: 7, belowMin: many, belowSubPar: many, zeroFloor: many, expiring: [], expiryWarnDays: 30, empty: false };
    const text = buildText(rep, 'วันนี้');
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toContain('OPD-DRUG-STOCK-MANAGER');
  });
  it('flex: every emergency row has an accent stripe, level pill and a days number; summary has the level strip', () => {
    const med = { id: 'x', name: 'D2', active: true, unit: 'เม็ด', parFloor: 10, parSub: 0, noSubstock: true, used30: 300, floor: 25 };
    const flex = buildFlex(buildReport({ meds: [med], lots: [], now: NOW }), 'x');
    const s = JSON.stringify(flex);
    expect(s).toContain('เร่งด่วนมาก');
    expect(s).toContain('"cornerRadius":"20px"'); // the pill
    expect(JSON.stringify(flex.contents.contents[0])).toContain('"height":"8px"'); // level strip
  });
});

describe('notify-low-stock — stale usage statistics warning', () => {
  const NOW = Date.parse('2026-11-25T03:00:00Z');
  const med = { id: 'x', name: 'D2', active: true, unit: 'เม็ด', parFloor: 10, parSub: 0, noSubstock: true, used30: 300, floor: 25 };
  it('warns on the text and the summary card when the daily usage job has not run for > 3 days', () => {
    const rep = buildReport({ meds: [med], lots: [], now: NOW, usageStatsRecomputedAt: NOW - 6 * 86400000 });
    expect(rep.usageStaleDays).toBe(6);
    expect(buildText(rep, 'x')).toContain('ไม่ได้อัปเดตมา 6 วัน');
    expect(JSON.stringify(buildFlex(rep, 'x').contents.contents[0])).toContain('ไม่ได้อัปเดตมา 6 วัน');
  });
  it('is silent when fresh, and when the timestamp is unknown', () => {
    expect(buildText(buildReport({ meds: [med], lots: [], now: NOW, usageStatsRecomputedAt: NOW - 86400000 }), 'x')).not.toContain('ไม่ได้อัปเดต');
    expect(buildText(buildReport({ meds: [med], lots: [], now: NOW }), 'x')).not.toContain('ไม่ได้อัปเดต');
  });
});
