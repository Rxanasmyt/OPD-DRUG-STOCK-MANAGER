// Regression test for a real request: "ตรวจสอบการเบิกใช้ยา การเติมหน้างานว่า...เห็นง่ายว่า...เอายา
// ที่ไหน" — this row already showed the floor shelf code (where the stock is HEADED, via
// binDisplayAll), but nothing on screen said where to actually go PICK it from in substock,
// even though the printed ใบเติมหน้างานประจำวัน sheet already carries this exact "หยิบจาก
// (substock)" column (see printTodayReplenishList's own pickBin). See TransferScreen.tsx's own
// "Real-world request" comment on the new purple badge.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED_WITH_SUBBIN = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'C7', binSub: 'S12',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// Substock-using (so it actually appears in this screen's own list), but no binSub assigned
// yet — the common case for a med added before someone got around to recording its substock
// shelf code (see Med.binSub's own doc comment).
const MED_NO_SUBBIN = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'D8',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — substock pick-location badge regression', () => {
  it('shows a distinct "หยิบ <substock bin>" badge alongside the floor destination bin', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_WITH_SUBBIN]);
    fireCollection('lots', []);

    await screen.findByText(MED_WITH_SUBBIN.name);
    expect(screen.getByText('หยิบ S12')).toBeInTheDocument();
    expect(screen.getByText('C7')).toBeInTheDocument();
  });

  it('hides the pick-location badge for a med with no substock shelf code assigned yet', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_NO_SUBBIN]);
    fireCollection('lots', []);

    await screen.findByText(MED_NO_SUBBIN.name);
    // The floor-destination badge still shows (there IS a floor bin) — only the pick-from
    // badge is conditional on binSub actually being set.
    expect(screen.getByText('D8')).toBeInTheDocument();
    expect(screen.queryByText(/^หยิบ /)).not.toBeInTheDocument();
  });
});
