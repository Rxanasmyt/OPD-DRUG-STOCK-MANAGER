// Regression test for a real audit finding: the "📜 ยอดคงคลังย้อนหลัง" tab's footer total summed
// the RAW, unrounded per-med values and rounded only that final sum, while each row displayed
// nf(Math.round(r.value)) independently — the exact mismatch class ReportScreen.test.tsx's own
// "category total accuracy regression" already documents and fixed for a DIFFERENT tab. This
// table shows every med in the formulary (not a Top N), so a PTC/pharmacy-head reviewer adding
// up the visible rows by hand is exactly the real scenario at stake. See ReportScreen.tsx's own
// "Bug fix (report accuracy, audit finding)" comment on stockAsOfTotalValue.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// price 1.50 × floor 7 = 10.50 → displayed row rounds to "11".
const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Amlodipine 10mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1.5, had: false, active: true, parSub: 0, parFloor: 5, floor: 7, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// price 2.25 × floor 2 = 4.50 → displayed row rounds to "5". Raw sum 10.50 + 4.50 = 15.00
// (exact) rounds to "15" — but the rows a reader sees add up to 11 + 5 = 16.
const MED_B = {
  id: 'm2', code: 'MED-0002', name: 'Warfarin 2mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2.25, had: false, active: true, parSub: 0, parFloor: 5, floor: 2, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('ReportScreen — stockasof total accuracy regression', () => {
  it('sums the SAME rounded values shown on each row, not the raw pre-rounding sum', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_A, MED_B]);
    fireCollection('lots', []);
    fireCollection('txs', []);

    await user.click(screen.getByRole('button', { name: '📜 ยอดคงคลังย้อนหลัง' }));
    await screen.findByText(MED_A.name);

    // Without the fix, the headline would read "15 บาท" (raw 10.5 + 4.5, rounded once) instead
    // of "16 บาท" (the sum of the two rounded rows a reader would actually add up).
    await screen.findByText('16 บาท');
    expect(screen.queryByText('15 บาท')).not.toBeInTheDocument();
  });
});
