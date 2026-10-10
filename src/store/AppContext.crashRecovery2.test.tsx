// Regression test for a real stability-audit finding: cart/recvItems/returnCart already had
// crash recovery (see AppContext.crashRecovery.test.tsx), but the ปรับยอด/คืนยา form, the
// ย้ายยาระหว่างชั้นวาง form, and the pasted HOSxP reconciliation text stayed purely in-memory —
// the same "a crashed tab, an accidental swipe-back/refresh, or the tablet's own hourly
// SW-update check landing badly" risk AppContext.tsx's own crash-recovery comment describes,
// just for three forms that hadn't caught up to the fix yet. See AppContext.tsx's
// adjStorageKey/wmStorageKey/hosxpStorageKey.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function AdjustHarness() {
  const { state, pickAdjType, pickAdjMed, setAdjQty, setAdjReason } = useApp();
  return (
    <div>
      <button onClick={() => pickAdjType('damaged')}>pick-damaged-type</button>
      <button onClick={() => pickAdjMed(MED.id)}>pick-med</button>
      <button onClick={() => setAdjQty('3')}>set-qty-3</button>
      <button onClick={() => setAdjReason('ขวดแตก')}>set-reason</button>
      <div data-testid="adjMed">{state.adjMed ?? ''}</div>
      <div data-testid="adjQty">{state.adjQty}</div>
      <div data-testid="adjReason">{state.adjReason}</div>
    </div>
  );
}

function WardMoveHarness() {
  const { state, pickWmFromMed, setWmQty, setWmReason } = useApp();
  return (
    <div>
      <button onClick={() => pickWmFromMed(MED.id)}>pick-from-med</button>
      <button onClick={() => setWmQty('4')}>set-qty-4</button>
      <button onClick={() => setWmReason('แบ่งไปลิ้นชัก stat')}>set-reason</button>
      <div data-testid="wmFromMed">{state.wmFromMed ?? ''}</div>
      <div data-testid="wmQty">{state.wmQty}</div>
    </div>
  );
}

function HosxpHarness() {
  const { state, setHosxpText } = useApp();
  return (
    <div>
      <button onClick={() => setHosxpText('Paracetamol 500mg\t120')}>paste-text</button>
      <div data-testid="hosxpText">{state.hosxpText}</div>
    </div>
  );
}

describe('adjust form — crash recovery regression', () => {
  it('restores an in-progress adjust/damaged entry after a simulated crash/reload for the SAME uid', async () => {
    const user = userEvent.setup();
    const first = renderWithApp(<AdjustHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'pick-damaged-type' }));
    await user.click(screen.getByRole('button', { name: 'pick-med' }));
    await user.click(screen.getByRole('button', { name: 'set-qty-3' }));
    await user.click(screen.getByRole('button', { name: 'set-reason' }));
    await waitFor(() => expect(screen.getByTestId('adjMed').textContent).toBe(MED.id));

    // Simulate a crash/refresh: tear down the whole React tree without ever going through logout.
    first.unmount();

    const second = renderWithApp(<><AdjustHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    // Without the fix, these would all come back empty — the whole entry lost.
    await waitFor(() => expect(screen.getByTestId('adjMed').textContent).toBe(MED.id));
    expect(screen.getByTestId('adjQty').textContent).toBe('3');
    expect(screen.getByTestId('adjReason').textContent).toBe('ขวดแตก');
    await screen.findByText(/กู้แบบฟอร์มปรับยอด\/คืนยา.*คืนแล้ว/);
    second.unmount();
  });
});

describe('ward-move form — crash recovery regression', () => {
  it('restores an in-progress ward-move entry after a simulated crash/reload for the SAME uid', async () => {
    const user = userEvent.setup();
    const first = renderWithApp(<WardMoveHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'pick-from-med' }));
    await user.click(screen.getByRole('button', { name: 'set-qty-4' }));
    await user.click(screen.getByRole('button', { name: 'set-reason' }));
    await waitFor(() => expect(screen.getByTestId('wmFromMed').textContent).toBe(MED.id));

    first.unmount();

    const second = renderWithApp(<><WardMoveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    // Without the fix, these would come back empty.
    await waitFor(() => expect(screen.getByTestId('wmFromMed').textContent).toBe(MED.id));
    expect(screen.getByTestId('wmQty').textContent).toBe('4');
    await screen.findByText(/กู้แบบฟอร์มย้ายยาระหว่างชั้นวาง.*คืนแล้ว/);
    second.unmount();
  });
});

describe('HOSxP pasted-text — crash recovery regression', () => {
  it('restores pasted-but-not-yet-parsed HOSxP text after a simulated crash/reload for the SAME uid', async () => {
    const user = userEvent.setup();
    const first = renderWithApp(<HosxpHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'paste-text' }));
    await waitFor(() => expect(screen.getByTestId('hosxpText').textContent).toContain('Paracetamol'));

    first.unmount();

    const second = renderWithApp(<><HosxpHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    // Without the fix, the pasted text would be gone — a full re-paste/re-copy from HOSxP needed.
    await waitFor(() => expect(screen.getByTestId('hosxpText').textContent).toContain('Paracetamol'));
    await screen.findByText(/กู้ข้อมูลนำเข้า HOSxP.*คืนแล้ว/);
    second.unmount();
  });
});
