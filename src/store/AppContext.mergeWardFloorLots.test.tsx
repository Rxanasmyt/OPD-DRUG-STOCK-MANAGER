// Regression test for a real audit finding found while deduping mergeWardMeds()/
// mergeAllWardPairs() (near-identical merge transactions that had drifted apart): mergeWardMeds
// (single-pair) reassigns BOTH `lots` (substock) and `floorLots` (floor-level batches) docs off
// the losing IPD med onto the surviving OPD med — but mergeAllWardPairs' bulk "รวมกันเลย" path
// only ever reassigned `lots`, never `floorLots`. A floorLots doc for the IPD med's floor stock
// silently kept pointing at a now-inactive, merged-away med id after a bulk merge, dropping out
// of every floor-lot-aware view (FEFO floor picks, floor aging) with no error anywhere. Fixed by
// extracting one shared mergeWardPairTx() helper both functions now call, so this class of
// "fixed in one copy, forgotten in the other" bug can't silently reopen the next time either
// gets touched.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import {
  signInAs, fireCollection, hasListener, seedCollection, getLastTransactionWrites,
} from '../test-utils/firebaseTestDouble';
import { asMedId } from '../types';

const OPD_MED = {
  id: asMedId('mOpd'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 4, usedPrev30: 2, volatility: 0, ward: 'opd' as const,
};
const IPD_MED = {
  ...OPD_MED, id: asMedId('mIpd'), floor: 5, used30: 1, usedPrev30: 1, bin: 'B2', ward: 'ipd' as const,
};
const IPD_FLOOR_LOT = { id: 'fl1', medId: 'mIpd', lotNo: 'L1', qty: 5, exp: Date.now() + 86400000 };

function AutoConfirmYes() {
  const { state, respondConfirm } = useApp();
  useEffect(() => { if (state.confirmDialog) respondConfirm(true); }, [state.confirmDialog, respondConfirm]);
  return null;
}

function MergeAllWardPairsHarness() {
  const { mergeAllWardPairs } = useApp();
  return <button onClick={() => mergeAllWardPairs()}>merge-all</button>;
}

function MergeWardHarness() {
  const { mergeWardMeds } = useApp();
  return <button onClick={() => mergeWardMeds(OPD_MED.id, IPD_MED.id)}>merge-ward</button>;
}

describe('mergeAllWardPairs — floorLots reassignment regression', () => {
  it('reassigns a floorLots doc off the merged-away IPD med onto the surviving OPD med', async () => {
    const user = userEvent.setup();
    renderWithApp(<><MergeAllWardPairsHarness /><AutoConfirmYes /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [OPD_MED, IPD_MED]);
    seedCollection('lots', []);
    seedCollection('floorLots', [IPD_FLOOR_LOT]);
    await screen.findByRole('button', { name: 'merge-all' });

    await user.click(screen.getByRole('button', { name: 'merge-all' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    // Without the fix, mergeAllWardPairs never touches floorLots at all — this write is simply
    // missing from the transaction, silently orphaning the floor batch on the merged-away med.
    const floorLotWrite = getLastTransactionWrites().find((w) => w.path === 'floorLots/fl1');
    expect(floorLotWrite?.data.medId).toBe('mOpd');
  });
});

describe('mergeWardMeds — floorLots reassignment non-regression', () => {
  it('still reassigns a floorLots doc off the merged-away IPD med (already correct before the dedup)', async () => {
    const user = userEvent.setup();
    renderWithApp(<><MergeWardHarness /><AutoConfirmYes /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [OPD_MED, IPD_MED]);
    seedCollection('lots', []);
    seedCollection('floorLots', [IPD_FLOOR_LOT]);
    await screen.findByRole('button', { name: 'merge-ward' });

    await user.click(screen.getByRole('button', { name: 'merge-ward' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const floorLotWrite = getLastTransactionWrites().find((w) => w.path === 'floorLots/fl1');
    expect(floorLotWrite?.data.medId).toBe('mOpd');
  });
});
