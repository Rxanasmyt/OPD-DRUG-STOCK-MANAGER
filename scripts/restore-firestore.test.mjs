// Regression test for a real operational bug (audit finding): the malformed-row safety check
// used to run INSIDE the same per-collection loop as the actual writes, with the
// "any malformed rows found?" check only happening AFTER that whole loop finished. With
// --confirm, a malformed row in a LATER collection didn't stop anything — every EARLIER
// collection had already been fully written (live overwrites — see restore-firestore.mjs's own
// set()-with-no-merge comment) by the time the loop even reached the bad one. The fix splits
// validation and writing into two passes: validate every row across the WHOLE file first, throw
// before any write starts if anything's wrong, then write only once that full pass is clean.
// This test proves no collection is written when a later one has a malformed row, and that the
// normal all-rows-valid case still writes everything.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { commitCalls, setCalls } = vi.hoisted(() => ({ commitCalls: [], setCalls: [] }));

vi.mock('node:fs/promises', () => {
  const readFile = vi.fn();
  return { readFile, default: { readFile } };
});
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn((x) => x),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    batch: () => ({
      set: (ref, fields) => { setCalls.push({ ref, fields }); },
      commit: async () => { commitCalls.push(true); },
    }),
    collection: (name) => ({ doc: (id) => ({ name, id }) }),
  }),
}));

describe('restore-firestore — validate-before-write ordering regression', () => {
  beforeEach(() => {
    commitCalls.length = 0;
    setCalls.length = 0;
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'opd-drug-stock' });
  });

  it('writes nothing to any collection when a LATER collection has a malformed row (no partial writes)', async () => {
    const { readFile } = await import('node:fs/promises');
    readFile.mockResolvedValue(JSON.stringify({
      collA: [{ id: 'a1', x: 1 }, { id: 'a2', x: 2 }], // all valid, listed FIRST
      collB: [{ id: '', x: 3 }], // malformed — empty id, listed SECOND
    }));
    process.argv = ['node', 'restore-firestore.mjs', 'backup.json', '--confirm'];

    const { main } = await import('./restore-firestore.mjs');
    await expect(main()).rejects.toThrow(/no valid string "id"/);

    // The bug: collA's two valid docs would already have been committed by the time the loop
    // reached collB's malformed row. The fix: nothing is written at all once any row anywhere
    // in the file is malformed.
    expect(commitCalls.length).toBe(0);
    expect(setCalls.length).toBe(0);
  });

  it('still writes every collection when every row is valid (the fix did not break the normal case)', async () => {
    const { readFile } = await import('node:fs/promises');
    readFile.mockResolvedValue(JSON.stringify({
      collA: [{ id: 'a1', x: 1 }],
      collB: [{ id: 'b1', x: 2 }],
    }));
    process.argv = ['node', 'restore-firestore.mjs', 'backup.json', '--confirm'];

    const { main } = await import('./restore-firestore.mjs');
    await main();

    expect(setCalls.length).toBe(2);
    expect(commitCalls.length).toBe(2); // one batch commit per collection
  });

  it('writes nothing in a dry run even when all rows are valid (no --confirm)', async () => {
    const { readFile } = await import('node:fs/promises');
    readFile.mockResolvedValue(JSON.stringify({ collA: [{ id: 'a1', x: 1 }] }));
    process.argv = ['node', 'restore-firestore.mjs', 'backup.json']; // no --confirm

    const { main } = await import('./restore-firestore.mjs');
    await main();

    expect(setCalls.length).toBe(0);
    expect(commitCalls.length).toBe(0);
  });
});
