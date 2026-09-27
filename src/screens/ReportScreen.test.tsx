// Regression test for a real report-accuracy bug: the "แยกตามหมวดยา" (by category) tab's
// footer total used to sum the RAW, unrounded per-category values and round only that final
// sum, while each row displayed nf(r.value) — Math.round — independently. Two categories that
// each carry a ".5 บาท" fractional remainder can individually round UP on screen while their
// raw sum rounds DOWN, so a reader adding up the visible rows by hand gets a different total
// than the report itself. See ReportScreen.tsx's own "Bug fix (report accuracy)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// price 1.50 × floor 7 = 10.50 → displayed row rounds to "11 บาท".
const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Amlodipine 10mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1.5, had: false, active: true, parSub: 0, parFloor: 5, floor: 7, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0, category: 'pain',
};
// price 2.25 × floor 2 = 4.50 → displayed row rounds to "5 บาท". Raw sum 10.50 + 4.50 = 15.00
// (exact, no float artifact needed) rounds to "15 บาท" — but 11 + 5 = 16.
const MED_B = {
  id: 'm2', code: 'MED-0002', name: 'Warfarin 2mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2.25, had: false, active: true, parSub: 0, parFloor: 5, floor: 2, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0, category: 'steroid',
};

describe('ReportScreen — category total accuracy regression', () => {
  it('sums the SAME rounded values shown on each row, not the raw pre-rounding sum', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_A, MED_B]);
    fireCollection('lots', []);

    await user.click(await screen.findByRole('button', { name: 'แยกตามหมวดยา' }));

    // The two rows the reader actually sees.
    await screen.findByText('11 บาท');
    await screen.findByText('5 บาท');

    // Without the fix, the footer would read "15 บาท" (raw 10.5 + 4.5, rounded once) instead of
    // "16 บาท" (the sum of the two rounded rows a reader would actually add up).
    expect(screen.getByText(/มูลค่าคงคลังรวมทุกหมวด/).textContent).toContain('16 บาท');
    expect(screen.queryByText(/15 บาท/)).not.toBeInTheDocument();
  });
});
