// Regression test for a real gap found by audit ("ปลอดภัย ถูกต้อง" — safety/correctness pass):
// toastErr (AppContext.tsx, see its own doc comment) is the ONE place that tells a user "no
// internet signal — not saved yet" on a timeout/offline write, instead of a flat generic
// failure message, and feeds the double-submit-on-timeout guard (see guardOnce's own regression
// tests). Several write actions had plain `catch (e) { console.error(e); toast('...'); }`
// instead — silently losing that connection-specific feedback despite using the same
// withTimeout()-wrapped writes every sibling action already surfaces correctly through
// toastErr. Fixed: applyOnePar, updateGlobalSettings, updateMedFull, toggleMedActive,
// startStockHold, endStockHold, scrapLot, setUserRole, toggleUserActive. This covers a plain
// updateDoc-based one (toggleMedActive) and a transaction-based one (scrapLot) — the two
// distinct write mechanisms among the nine fixed.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateDoc, runTransaction } from 'firebase/firestore';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { TimeoutError } from '../utils/timeout';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function ToggleMedActiveHarness() {
  const { toggleMedActive } = useApp();
  return <button onClick={() => toggleMedActive(MED.id)}>toggle-active</button>;
}

function ScrapLotHarness() {
  const { scrapLot } = useApp();
  return <button onClick={() => scrapLot('lot1')}>scrap-lot</button>;
}

describe('toggleMedActive — toastErr regression (plain updateDoc write)', () => {
  it('shows the connection-specific message on a timeout, not a flat generic failure', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ToggleMedActiveHarness /><Toast /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    vi.mocked(updateDoc).mockRejectedValueOnce(new TimeoutError());
    await user.click(await screen.findByText('toggle-active'));

    await screen.findByText(/การเชื่อมต่อช้าเกินไปหรือขาดหาย/);
    expect(screen.queryByText('เปลี่ยนสถานะไม่สำเร็จ')).not.toBeInTheDocument();
  });
});

describe('scrapLot — toastErr regression (transaction-based write)', () => {
  it('shows the connection-specific message on a timeout, not a flat generic failure', async () => {
    const user = userEvent.setup();
    const LOT = { id: 'lot1', medId: MED.id, lotNo: 'L1', qty: 10, exp: Date.now() + 86400000 };
    renderWithApp(<><ScrapLotHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [LOT]);

    vi.mocked(runTransaction).mockRejectedValueOnce(new TimeoutError());
    await user.click(await screen.findByText('scrap-lot'));
    await user.click(await screen.findByRole('button', { name: 'ยืนยัน' }));

    await screen.findByText(/การเชื่อมต่อช้าเกินไปหรือขาดหาย/);
    expect(screen.queryByText('ตัด lot ไม่สำเร็จ ลองใหม่อีกครั้ง')).not.toBeInTheDocument();
  });
});
