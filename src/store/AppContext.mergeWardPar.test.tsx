// Regression test for a real audit finding: mergeWardPairTx() pools floor/used30/usedPrev30
// across OPD+IPD when merging a ward pair into one shared record, but used to leave the
// surviving OPD med's own parFloor/parSub untouched. Those values are sized for OPD-only demand
// — after the merge, the shelf has to cover combined OPD+IPD demand, so an unmodified parFloor
// silently undersizes Max for the pooled shelf. floorMinOf()'s "ต้องเติมหน้างาน"/urgent-refill
// thresholds are based on parFloor, so this would under-alert relative to the drug's real
// combined usage until someone separately happened to run a par re-suggestion — with nothing
// anywhere telling staff that's now needed. Fixed by summing both sides' parFloor/parSub, same
// treatment floor/used30/usedPrev30 already get in this same transaction.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedCollection, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';
import { asMedId } from '../types';

// Distinct parFloor/parSub on each side (not just double of one number) so a passing assertion
// can only mean real summing happened, not a coincidence.
const OPD_MED = {
  id: asMedId('mOpd'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 4, usedPrev30: 2, volatility: 0, ward: 'opd' as const,
};
const IPD_MED = {
  ...OPD_MED, id: asMedId('mIpd'), floor: 5, used30: 1, usedPrev30: 1, bin: 'B2', ward: 'ipd' as const,
  parFloor: 60, parSub: 300,
};

function AutoConfirmYes() {
  const { state, respondConfirm } = useApp();
  useEffect(() => { if (state.confirmDialog) respondConfirm(true); }, [state.confirmDialog, respondConfirm]);
  return null;
}

function MergeWardHarness() {
  const { mergeWardMeds } = useApp();
  return <button onClick={() => mergeWardMeds(OPD_MED.id, IPD_MED.id)}>merge-ward</button>;
}

describe('mergeWardMeds — pooled par (Max/substock reorder point) regression', () => {
  it('sums both sides\' parFloor/parSub into the surviving OPD med instead of leaving them OPD-only-sized', async () => {
    const user = userEvent.setup();
    renderWithApp(<><MergeWardHarness /><AutoConfirmYes /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [OPD_MED, IPD_MED]);
    seedCollection('lots', []);
    seedCollection('floorLots', []);
    await screen.findByRole('button', { name: 'merge-ward' });

    await user.click(screen.getByRole('button', { name: 'merge-ward' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    // Without the fix, this would stay 100/500 (OPD's own values) even though the merged shelf
    // now has to cover both sides' demand.
    const opdWrite = getLastTransactionWrites().find((w) => w.path === 'meds/mOpd');
    expect(opdWrite?.data.parFloor).toBe(160);
    expect(opdWrite?.data.parSub).toBe(800);
  });
});
