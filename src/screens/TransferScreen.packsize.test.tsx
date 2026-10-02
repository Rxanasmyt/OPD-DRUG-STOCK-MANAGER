// Regression test for a real request: "หน้าเติมยาเข้าขั้นหน้างาน และเบิกเข้า substock อยากให้มี
// รายละเอียดว่า 1 กล่องมีจำนวนยาเท่าไรครับ...ให้ทุกคนรู้ได้ว่า 1 กล่องจำนวนเท่าไร" — DeficitBadge's
// own box breakdown only ever shows while there's an actual deficit right now; a shelf already
// at/above its own Min renders no deficit badge at all, so the box-size fact disappeared
// entirely the moment nothing was currently short. See components/Qty.tsx's PackSizeBadge own
// "Real-world request" comment — it is unconditional on today's stock level.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// floor already AT parFloor (Max) — no deficit, so DeficitBadge itself renders nothing.
const BOXED_MED_NO_DEFICIT = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 100, bin: 'A1', packSize: 30,
  used30: 0, usedPrev30: 0, volatility: 0,
};
const PLAIN_MED_NO_DEFICIT = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 100, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — unconditional box-size badge regression', () => {
  it('shows "กล่องละ N หน่วย" for a boxed med even with zero deficit, and nothing for a plain med', async () => {
    const user = userEvent.setup();
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED_NO_DEFICIT, PLAIN_MED_NO_DEFICIT]);
    fireCollection('lots', []);

    // Neither med is below its own Min, so the default "ต่ำกว่า Min" filter hides both —
    // switch to "ทั้งหมด" to see them (this screen's own default-filter behavior, unrelated to
    // what's under test here).
    await user.click(screen.getByRole('button', { name: 'ทั้งหมด' }));
    await screen.findByText(PLAIN_MED_NO_DEFICIT.name);
    expect(screen.getByText('📦 กล่องละ 30 เม็ด')).toBeInTheDocument();
    expect(screen.queryByText(/ต้องเติม/)).not.toBeInTheDocument();
  });
});
