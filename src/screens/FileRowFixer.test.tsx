import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'AMLODIPINE 10 mg เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1000, parFloor: 1000, floor: 5000, bin: 'C4-6',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness() {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText('AMLODIPINE 10 mg tablet film,1558'); }, [state.hosxpText, setHosxpText]);
  return (<><button onClick={() => void processHosxp()}>process</button><ReconcileScreen /></>);
}

describe('FileRowFixer — an unmatched file row is actionable and gates the commit', () => {
  it('suggests the drug with the exact differences, blocks commit until mapped, then deducts', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await user.click(screen.getByRole('button', { name: 'process' }));

    const fixer = await screen.findByTestId('file-row-fixer');
    expect(fixer.textContent).toContain('AMLODIPINE 10 mg เม็ด');
    expect(fixer.textContent).toContain('ความแรงตรงกัน');
    expect(screen.getByText(/ยังตัดยอดไม่ได้/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ใช่ — จับคู่ยานี้/ }));
    await waitFor(() => expect(screen.queryByTestId('file-row-fixer')).not.toBeInTheDocument());
    expect(screen.queryByText(/ยังตัดยอดไม่ได้/)).not.toBeInTheDocument();
    expect(screen.getByText('−1,558')).toBeInTheDocument();
  });

  it('an explicitly skipped row stops blocking the commit and is shown as an acknowledged skip', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await user.click(screen.getByRole('button', { name: 'process' }));
    await screen.findByTestId('file-row-fixer');
    await user.click(screen.getByRole('button', { name: /ข้าม$/ }));
    expect(await screen.findByText(/รับทราบ: ข้ามรายการนี้/)).toBeInTheDocument();
    expect(screen.queryByText(/ยังตัดยอดไม่ได้/)).not.toBeInTheDocument();
  });
});
