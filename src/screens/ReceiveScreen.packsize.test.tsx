// Regression test for the same real request as TransferScreen.packsize.test.tsx: "...เบิกเข้า
// substock อยากให้มีรายละเอียดว่า 1 กล่องมีจำนวนยาเท่าไรครับ...ให้ทุกคนรู้ได้ว่า 1 กล่องจำนวน
// เท่าไร" — boxRequestNote only ever fires once there's an actual shortfall to request right now
// (need <= 0 → null); this med search-result list should show the box-size fact unconditionally
// via PackSizeBadge, visible BEFORE even picking a med to receive.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceiveScreen from './ReceiveScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// substock already at par — no shortfall, so boxRequestNote itself would show nothing.
const BOXED_MED_AT_PAR = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: 'A1', packSize: 30,
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('ReceiveScreen — unconditional box-size badge regression', () => {
  it('shows "กล่องละ N หน่วย" in the search-result row even with no current shortfall', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED_AT_PAR]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [{ id: 'l1', medId: BOXED_MED_AT_PAR.id, lotNo: 'L1', qty: 500, exp: Date.now() + 300 * 86400000 }]);

    await user.type(screen.getByPlaceholderText('ค้นหา / สแกนชื่อยา'), 'Amoxi');
    await screen.findByText(BOXED_MED_AT_PAR.name);
    expect(screen.getByText('📦 กล่องละ 30 เม็ด')).toBeInTheDocument();
  });
});
