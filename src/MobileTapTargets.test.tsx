// Regression test for a real-device mobile UX audit ("ช่วยตรวจดูอย่างละเอียดว่ามีจุดไหนที่สามารถ
// พัฒนาเพื่อให้แอพทำงานผ่านโทรศัพท์ได้สะดวกรวดเร็ว ใช้งานง่าย"): several icon buttons used to be
// well under this app's own ~44px tap-target convention (see ReceiveScreen's CardPeekButton,
// whose own "Bug fix (usability)" comment established 44px as the app-wide standard) — a real
// mis-tap risk on a phone used one-handed. Locks in the fix for each one so none of them regress
// back to an undersized hit area.
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import QrModal from './components/QrModal';
import LoginScreen from './screens/LoginScreen';
import { SearchInput } from './components/SearchInput';
import { useApp } from './store/AppContext';
import { renderWithApp } from './test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, fireAuth } from './test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function OpenScannerHarness() {
  const { openScanSearch } = useApp();
  return <button onClick={() => openScanSearch('viewMed')}>open-scanner</button>;
}

describe('Mobile tap-target-size regression (real-device UX audit)', () => {
  it('sizes SearchInput\'s clear (✕) button hit area to 44px, keeping the visible dot small', () => {
    render(<SearchInput value="amox" onChange={() => {}} />);
    const btn = screen.getByLabelText('ล้างคำค้นหา');
    // Without the fix, this was 28x28 — the hit area, not just the visible circle.
    expect(btn.style.width).toBe('44px');
    expect(btn.style.height).toBe('44px');
  });

  it('sizes the header back button and QR-scan button to 44px on a CAN_BACK screen', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    await screen.findByRole('navigation');
    // Navigate to "more" then into "ย้ายยาระหว่างชั้นวาง" (wardmove, a CAN_BACK screen) so the
    // header renders the back button instead of the hospital crest.
    const moreBtn = await screen.findByRole('button', { name: /เพิ่มเติม/ });
    await user.click(moreBtn);
    const wardMoveBtn = await screen.findByText('ย้ายยาระหว่างชั้นวาง');
    await user.click(wardMoveBtn);

    const backBtn = await screen.findByText('←');
    // Without the fix, this was 32x32.
    expect(backBtn.style.width).toBe('44px');
    expect(backBtn.style.height).toBe('44px');

    const qrBtn = await screen.findByLabelText('สแกน QR ค้นหายา');
    // Without the fix, this was 32x32.
    expect(qrBtn.style.width).toBe('44px');
    expect(qrBtn.style.height).toBe('44px');
  });

  it('sizes the QR-scanner close button and manual-entry close button to 44px', async () => {
    const user = userEvent.setup();
    renderWithApp(<><OpenScannerHarness /><QrModal /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });

    await user.click(screen.getByText('open-scanner'));
    const closeBtn = await screen.findByLabelText('ปิดกล้องสแกน');
    // Without the fix, this was 36x36.
    expect(closeBtn.style.width).toBe('44px');
    expect(closeBtn.style.height).toBe('44px');

    await user.click(screen.getByText('กรอกรหัสด้วยมือ (กรณีฉลากชำรุด)'));
    const manualCloseBtn = await screen.findByLabelText('ปิดช่องกรอกรหัสด้วยมือ');
    // Without the fix, this was 30x30.
    expect(manualCloseBtn.style.width).toBe('44px');
    expect(manualCloseBtn.style.height).toBe('44px');
  });

  it('sizes the Login password show/hide toggle to 44px', async () => {
    renderWithApp(<LoginScreen />);
    fireAuth(null);
    await waitFor(() => expect(screen.getByText('KPNHOS')).toBeInTheDocument());

    const toggleBtn = screen.getByLabelText('แสดงรหัสผ่าน');
    // Without the fix, this was 32x32.
    expect(toggleBtn.style.width).toBe('44px');
    expect(toggleBtn.style.height).toBe('44px');
  });
});
