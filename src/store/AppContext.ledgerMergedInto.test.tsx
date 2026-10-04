// Regression test for a real audit finding: fetchFloorLedger/fetchSubstockLedger's OPD/IPD
// name-twin disambiguation used to treat EVERY inactive same-name med as "not a live ambiguity,
// safe to blend its untagged history in" — correct for the real "รวมสต็อก OPD+IPD" merge case
// (mergeWardMeds/mergeAllWardPairs deliberately deactivates the losing side, and its old
// history SHOULD still count toward the survivor), but wrong for an unrelated duplicate med
// that merely happens to share a name and was deactivated for some other reason — that med's
// history has no business bleeding into a totally different drug's ledger. Med.mergedInto
// (types.ts) now lets the disambiguation tell the two apart. See AppContext.tsx's own comment
// on fetchSubstockLedger/fetchFloorLedger's mergedFromIds.
import { describe, it, expect } from 'vitest';
import { useEffect, useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedCollection } from '../test-utils/firebaseTestDouble';

const SURVIVOR = {
  id: 'opd1', code: 'MED-0001', name: 'Same Name Drug', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// The intentional merge-loser: deactivated by mergeWardMeds, tagged mergedInto the survivor.
const MERGED_LOSER = { ...SURVIVOR, id: 'ipd1', active: false, mergedInto: 'opd1', bin: 'B1' };
// An UNRELATED duplicate: happens to share the exact same name, deactivated for some other
// reason entirely (e.g. a data-entry mistake later cleaned up) — never merged into SURVIVOR.
const UNRELATED_DUP = { ...SURVIVOR, id: 'dup1', active: false, bin: 'C1' };

function LedgerHarness({ medId }: { medId: string }) {
  const { fetchSubstockLedger } = useApp();
  const [rows, setRows] = useState<{ qty: number; medId?: string }[] | null>(null);
  useEffect(() => { fetchSubstockLedger(medId).then((r) => setRows(r as typeof rows)); }, [medId, fetchSubstockLedger]);
  return <div data-testid="total">{rows ? rows.reduce((s, r) => s + r.qty, 0) : 'loading'}</div>;
}

describe('fetchSubstockLedger — mergedInto disambiguation regression', () => {
  it('includes the merged loser\'s own untagged history (intentional continuity)', async () => {
    renderWithApp(<LedgerHarness medId="opd1" />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [SURVIVOR, MERGED_LOSER]);
    seedCollection('txs', [
      { id: 't1', name: SURVIVOR.name, medId: 'opd1', type: 'receive_from_central', to: 'substock', qty: 10, ts: 1, by: 'x' },
      { id: 't2', name: SURVIVOR.name, medId: 'ipd1', type: 'receive_from_central', to: 'substock', qty: 5, ts: 2, by: 'x' },
    ]);

    // Without the fix this still passes (old code never narrowed for an inactive-only twin
    // either) — this test exists to prove the NEW mergedFromIds logic doesn't regress the
    // real, intentional continuity case while fixing the one below.
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('15'));
  });

  it('excludes an unrelated duplicate\'s history, even though it is also inactive', async () => {
    renderWithApp(<LedgerHarness medId="opd1" />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [SURVIVOR, UNRELATED_DUP]);
    seedCollection('txs', [
      { id: 't1', name: SURVIVOR.name, medId: 'opd1', type: 'receive_from_central', to: 'substock', qty: 10, ts: 1, by: 'x' },
      // UNRELATED_DUP's own real history — a totally different drug's receive, not SURVIVOR's.
      { id: 't2', name: SURVIVOR.name, medId: 'dup1', type: 'receive_from_central', to: 'substock', qty: 999, ts: 2, by: 'x' },
    ]);

    // Without the fix, this would be 1009 — UNRELATED_DUP's 999 wrongly blended in just because
    // it happens to be inactive, exactly the gap the audit flagged.
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('10'));
  });

  it('includes the merged loser AND excludes an unrelated duplicate when both exist at once', async () => {
    renderWithApp(<LedgerHarness medId="opd1" />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [SURVIVOR, MERGED_LOSER, UNRELATED_DUP]);
    seedCollection('txs', [
      { id: 't1', name: SURVIVOR.name, medId: 'opd1', type: 'receive_from_central', to: 'substock', qty: 10, ts: 1, by: 'x' },
      { id: 't2', name: SURVIVOR.name, medId: 'ipd1', type: 'receive_from_central', to: 'substock', qty: 5, ts: 2, by: 'x' },
      { id: 't3', name: SURVIVOR.name, medId: 'dup1', type: 'receive_from_central', to: 'substock', qty: 999, ts: 3, by: 'x' },
    ]);

    // The binary "narrow or don't" filter this replaced could only ever get ONE of these right
    // at a time once both a trusted merge-loser and an untrusted duplicate shared the name.
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('15'));
  });
});
