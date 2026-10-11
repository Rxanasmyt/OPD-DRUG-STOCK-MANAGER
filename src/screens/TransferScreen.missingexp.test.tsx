// Regression test for an audit finding: a lot doc missing `exp` (a real past bug per this
// codebase's own comments elsewhere — see AppContext.tsx's `?? Infinity` convention) used to
// make this screen's FEFO preview line call daysUntil()/thDate() on `undefined`, rendering
// "Invalid Date" instead of failing gracefully. See TransferScreen.tsx's own "Bug fix
// (type-safety audit)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'C7',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — FEFO lot missing exp regression', () => {
  it('shows a safe fallback instead of "Invalid Date" when the soonest substock lot has no exp', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    // exp intentionally omitted — the exact shape a manual Firestore console edit or a
    // partial/pre-migration write could produce.
    fireCollection('lots', [{ id: 'l1', medId: 'm1', lotNo: 'L1', qty: 20 }]);

    await screen.findByText(MED.name);
    await screen.findByText(/ไม่ทราบวันหมดอายุ/);
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});
