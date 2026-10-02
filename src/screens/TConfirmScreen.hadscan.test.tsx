// Regression test for a real request: "เติมยา HAD ไม่ต้องสแกน QR ซ้ำก่อนครับ" — TConfirmScreen's
// own high-alert re-scan step exists to prove the physical drug in hand really is the high-alert
// med it claims to be before it gets dispensed, but scanning that SAME med's own QR code to add
// it to the cart in the first place (openScanSearch('transfer') → qrDecoded) already proves
// exactly that — the scanner only accepted it because the decoded code matched this med. Asking
// for a second scan of the same physical item was a pure duplicate, not an extra safety check.
// A HAD med added by search/tap instead (no physical scan ever happened) must still go through
// the confirm-screen scan, same as before. See AppContext.tsx's own "Real-world request" comment
// right where hadOk gets set inside qrDecodedImpl's transfer branch.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TConfirmScreen from './TConfirmScreen';
import { useApp } from '../store/AppContext';
import { encodeQr } from '../utils/qr';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const HAD_MED = {
  id: 'm1', code: 'MED-0001', name: 'Heparin 5000U', unit: 'ขวด', dosageForm: 'ฉีด',
  price: 200, had: true, active: true, parSub: 20, parFloor: 5, floor: 1, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const HAD_LOT = { id: 'l1', medId: 'm1', lotNo: 'LOT-1', qty: 10, exp: Date.now() + 365 * 86400000 };

function ScanToAddHarness({ medCode }: { medCode: string }) {
  const { state, openScanSearch, qrDecoded } = useApp();
  return (
    <div>
      <button onClick={() => openScanSearch('transfer')}>open-scanner</button>
      <button disabled={state.qrPurpose !== 'transfer'} onClick={() => qrDecoded(encodeQr('med', medCode))}>decode-scan</button>
    </div>
  );
}

function PickByIdHarness({ medId }: { medId: string }) {
  const { bump } = useApp();
  return <button onClick={() => bump(medId, 1)}>pick-without-scan</button>;
}

describe('TConfirmScreen — HAD duplicate-scan regression', () => {
  it('does not ask for a confirm scan when the HAD med was already added by scanning its own QR', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ScanToAddHarness medCode={HAD_MED.code} /><TConfirmScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HAD_MED]);
    fireCollection('lots', [HAD_LOT]);

    await user.click(screen.getByRole('button', { name: 'open-scanner' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'decode-scan' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'decode-scan' }));

    await screen.findByText(HAD_MED.name);
    // Without the fix, this would show "ต้องสแกน QR ก่อนยืนยัน" and the big "สแกน QR ยา high
    // alert" button, blocking ยืนยันการเติมหน้างาน.
    expect(screen.queryByText('ต้องสแกน QR ก่อนยืนยัน')).not.toBeInTheDocument();
    await screen.findByText('✓ ยืนยัน QR แล้ว');
    expect(screen.getByRole('button', { name: 'ยืนยันการเติมหน้างาน' })).toBeInTheDocument();
  });

  it('still asks for a confirm scan when the HAD med was added by search/tap, not a scan', async () => {
    const user = userEvent.setup();
    renderWithApp(<><PickByIdHarness medId={HAD_MED.id} /><TConfirmScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HAD_MED]);
    fireCollection('lots', [HAD_LOT]);

    await user.click(screen.getByRole('button', { name: 'pick-without-scan' }));

    await screen.findByText(HAD_MED.name);
    await screen.findByText('ต้องสแกน QR ก่อนยืนยัน');
    expect(screen.getByRole('button', { name: /สแกน QR ยา high alert/ })).toBeInTheDocument();
  });
});
