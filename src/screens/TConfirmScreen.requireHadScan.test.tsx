// Regression test for a real request: "ยา HAD ไม่ต้องยืนยันสแกนก่อนครับ ตอนนี้ป้ายชั้นวางยายังไม่ได้
// ทำ" — a hospital still mid-rollout of its physical QR shelf labeling has nothing to scan for
// TConfirmScreen's high-alert re-scan step, which used to block EVERY high-alert transfer
// unconditionally with no way to comply. state.requireHadScan (meta/settings, admin-toggleable in
// SettingsScreen.tsx) lets an admin turn this gate off while labels aren't ready, and back on once
// they are — see its own doc comment (AppContext.tsx) for why it still defaults to on.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TConfirmScreen from './TConfirmScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, fireDoc, hasListener } from '../test-utils/firebaseTestDouble';
import { useApp } from '../store/AppContext';
import type { MedId } from '../types';

const HAD_MED = {
  id: 'm1' as MedId, code: 'MED-0001', name: 'Warfarin 3mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 5, had: true, active: true, parSub: 100, parFloor: 20, floor: 5, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const HAD_LOT = { id: 'l1', medId: 'm1', lotNo: 'L1', qty: 100, exp: Date.now() + 365 * 86400000 };

function PickHarness() {
  const { bump } = useApp();
  return <button onClick={() => bump(HAD_MED.id, 1)}>pick</button>;
}

describe('TConfirmScreen — requireHadScan setting regression', () => {
  it('skips the scan gate entirely when the admin has turned it off', async () => {
    const user = userEvent.setup();
    renderWithApp(<><PickHarness /><TConfirmScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireDoc('meta/settings', { requireHadScan: false });
    fireCollection('meds', [HAD_MED]);
    fireCollection('lots', [HAD_LOT]);

    await user.click(screen.getByRole('button', { name: 'pick' }));

    await screen.findByText(HAD_MED.name);
    expect(screen.queryByText('ต้องสแกน QR ก่อนยืนยัน')).not.toBeInTheDocument();
    expect(screen.queryByText(/สแกน QR ยา high alert/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยืนยันการเติมหน้างาน' })).toBeInTheDocument();
  });

  it('still gates on scan by default (setting not yet loaded/left at true)', async () => {
    const user = userEvent.setup();
    renderWithApp(<><PickHarness /><TConfirmScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HAD_MED]);
    fireCollection('lots', [HAD_LOT]);

    await user.click(screen.getByRole('button', { name: 'pick' }));

    await screen.findByText(HAD_MED.name);
    await screen.findByText('ต้องสแกน QR ก่อนยืนยัน');
    expect(screen.getByRole('button', { name: /สแกน QR ยา high alert/ })).toBeInTheDocument();
  });
});
