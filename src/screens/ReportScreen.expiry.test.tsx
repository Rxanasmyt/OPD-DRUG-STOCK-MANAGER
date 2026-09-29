// Regression test for a real report-accuracy bug: the "ภาพรวมผู้บริหาร" exec tile's own label
// ("มูลค่าเสี่ยงหมดอายุ ≤ {expiryWarnDays} วัน") already reads the real, admin-configurable
// expiryWarnDays setting (หน้าตั้งค่า), but the NUMBER next to it used to always sum a fixed
// expired+≤30+31-90-day window regardless of what that setting actually is — changing the
// setting moved the label but silently left the number wrong. See ReportScreen.tsx's own
// "Bug fix (data correctness)" comment on riskValue.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, fireDoc, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 10, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// exp 60 days out: inside the fixed old 31-90-day bucket (would count under the pre-fix hard-
// coded "≤90 days" sum) but OUTSIDE a 45-day expiryWarnDays setting — the exact boundary the
// bug silently ignored. qty 20 × price 10 = 200 บาท.
const LOT_60D = { id: 'l1', medId: 'm1', lotNo: 'LOT-60D', qty: 20, exp: Date.now() + 60 * 86400000 };

describe('ReportScreen — exec tile expiryWarnDays regression', () => {
  it('excludes a lot outside the configured expiryWarnDays from the risk-value tile, even though it sits inside the old fixed 90-day window', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [LOT_60D]);
    // Lower expiryWarnDays from its 90-day default to 45 — a normal admin action (หน้าตั้งค่า).
    fireDoc('meta/settings', { expiryWarnDays: 45 });

    // reportTab defaults to 'aging', not 'exec' — the exec tile lives on its own tab.
    await user.click(await screen.findByRole('button', { name: '📊 ภาพรวมผู้บริหาร' }));

    await screen.findByText('มูลค่าเสี่ยงหมดอายุ ≤ 45 วัน');
    const card = screen.getByText('มูลค่าเสี่ยงหมดอายุ ≤ 45 วัน').closest('.card') as HTMLElement;
    // Without the fix, this would still read "200 บาท" (the lot counted under the old fixed
    // ≤90-day sum); with the fix, a lot 60 days out is excluded once the real setting is 45.
    // getByText's default exact-match (not toHaveTextContent's substring match, which "200
    // บาท" would also satisfy) is required here — the value node's ENTIRE text must be "0 บาท".
    within(card).getByText('0 บาท');
    expect(within(card).queryByText('200 บาท')).not.toBeInTheDocument();
  });
});
