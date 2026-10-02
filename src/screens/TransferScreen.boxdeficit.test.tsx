// Regression test for a real request: "หน้าเติมหน้างาน...ถ้ามีหน่วยเป็นกล่อง บอกรายละเอียดกล่องละ
// เท่าไร ต้องเติมกี่กล่องจะดีมากครับ เนื่องจากการทำงานจริงเบิกยาและเติมหน้างานเป็นกล่องๆ" — a
// box-only med's DeficitBadge used to show only the raw unit deficit (e.g. "ต้องเติม 75 เม็ด"),
// leaving the real mental math (how many boxes, how many loose) to whoever's physically filling
// the shelf. See components/Qty.tsx's DeficitBadge own "Real-world request" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// parFloor 100, floor 25 → deficit 75. packSize 30 → 2 กล่อง + 15 เม็ด (not a clean multiple).
const BOXED_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 25, bin: 'A1', packSize: 30,
  used30: 0, usedPrev30: 0, volatility: 0,
};
// Same deficit shape but no packSize set — must keep showing only the plain unit deficit.
const PLAIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 25, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — DeficitBadge box breakdown regression', () => {
  it('shows the exact box+loose split for a med with packSize set, and nothing extra for one without', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED, PLAIN_MED]);
    fireCollection('lots', []);

    await screen.findByText(/ต้องเติม 75 เม็ด \(2 กล่อง \+ 15 เม็ด\)/);
    // PLAIN_MED's badge must not carry any box breakdown at all.
    const plainRow = (await screen.findByText(PLAIN_MED.name)).closest('.card') as HTMLElement;
    expect(plainRow.textContent).toMatch(/ต้องเติม 75 เม็ด/);
    expect(plainRow.textContent).not.toMatch(/กล่อง/);
  });
});
