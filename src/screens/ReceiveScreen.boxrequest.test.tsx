// Regression test for a real request: "...จำนวนยาที่ต้องเบิกจากคลัง...ถ้ามีหน่วยเป็นกล่อง บอก
// รายละเอียดกล่องละเท่าไร ต้องเบิกกี่กล่อง...เนื่องจากการทำงานจริงเบิกยาและเติมหน้างานเป็นกล่องๆ" —
// the "ควรเบิกจากคลังใหญ่" list used to show only the raw substock/par numbers for a box-only
// med, leaving the real box-count math to whoever's filling out the request by hand. Unlike
// TransferScreen's DeficitBadge (capped by whatever substock actually has), a WAREHOUSE request
// has no such cap, so it rounds UP to a whole box — same rounding printWarehouseRequestList's
// print sheet already uses. See ReceiveScreen.tsx's own boxRequestNote().
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReceiveScreen from './ReceiveScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// usesSubstock (noSubstock unset), sub qty 0 (no lots) → need = parSub - 0 = 500.
// packSize 30 → ceil(500/30) = 17 boxes (510 units) — rounds UP, never a fractional box.
const BOXED_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1', packSize: 30,
  used30: 0, usedPrev30: 0, volatility: 0,
};
// Same shortage shape but no packSize set — must show no box-request line at all.
const PLAIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('ReceiveScreen — "ควรเบิกจากคลังใหญ่" box-request regression', () => {
  it('shows the rounded-up box count for a med with packSize set, and nothing extra for one without', async () => {
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED, PLAIN_MED]);
    fireCollection('lots', []);
    fireCollection('pendingReceives', []);

    await screen.findByText(/เบิกเป็นกล่อง — 17x30/);
    const plainRow = (await screen.findByText(PLAIN_MED.name)).closest('div[role="button"]') as HTMLElement;
    expect(plainRow.textContent).not.toMatch(/เบิกเป็นกล่อง/);
    // Real-world request ("ui UX animation" audit): this is a role="button" DIV, which never
    // picks up the global `button:active` press feedback a real <button> gets automatically —
    // needs the row-interactive class explicitly or tapping it gives zero visual confirmation.
    expect(plainRow).toHaveClass('row-interactive');
  });
});
