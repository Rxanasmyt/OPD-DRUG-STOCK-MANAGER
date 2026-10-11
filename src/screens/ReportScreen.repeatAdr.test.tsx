// Regression test for a real request: "ควรมีข้อมูลอะไรอีกครับที่ควรเก็บข้อมูลแล้วสามารถดึงรายงาน
// มาวิเคราห์ผลได้" — tracing the data lifecycle found the return-reason picker (AdjustScreen)
// already writes a structured ADR/side-effect reason onto every return-type Tx, but nothing ever
// read it back out. The "🧠 วิเคราะห์อัตโนมัติ" tab's new "🩺 ยาที่มีรายงานแพ้ยา/ผลข้างเคียงซ้ำ"
// block flags any drug with 2+ return-type rows tagged with that exact reason. See selectors.ts's
// own repeatAdrReturns (unit-tested there) — this test locks in the UI wiring through the real
// AppProvider/useApp() plumbing specifically.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const ADR_REASON = 'แพ้ยา/ผลข้างเคียงการรักษา';

const PARACETAMOL = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0, category: 'pain',
};
const AMOXICILLIN = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'แคปซูล', dosageForm: 'แคปซูล',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0, category: 'antimicrobial',
};
const TXS = [
  { id: 't1', medId: 'm1', name: PARACETAMOL.name, type: 'return', qty: -2, unit: 'เม็ด', by: 'ทดสอบ ภก.', ts: Date.now() - 1000, reason: ADR_REASON },
  { id: 't2', medId: 'm1', name: PARACETAMOL.name, type: 'return', qty: -1, unit: 'เม็ด', by: 'ทดสอบ ภก.', ts: Date.now() - 2000, reason: ADR_REASON },
  // Amoxicillin only has ONE ADR return — a single one-off reaction, not a pattern, so it must
  // not show up at all.
  { id: 't3', medId: 'm2', name: AMOXICILLIN.name, type: 'return', qty: -1, unit: 'แคปซูล', by: 'ทดสอบ ภก.', ts: Date.now() - 3000, reason: ADR_REASON },
  // A second Paracetamol return with an unrelated reason must not count toward the ADR flag.
  { id: 't4', medId: 'm1', name: PARACETAMOL.name, type: 'return', qty: -1, unit: 'เม็ด', by: 'ทดสอบ ภก.', ts: Date.now() - 4000, reason: 'ไม่ประสงค์รับยา' },
];

describe('ReportScreen — repeat ADR-return insight regression', () => {
  it('flags only the drug with 2+ return rows tagged with the exact ADR reason', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PARACETAMOL, AMOXICILLIN]);
    fireCollection('lots', []);
    fireCollection('txs', TXS);

    await user.click(screen.getByRole('button', { name: '🧠 วิเคราะห์อัตโนมัติ' }));

    await screen.findByText('🩺 ยาที่มีรายงานแพ้ยา/ผลข้างเคียงซ้ำ');
    const row = screen.getByText('Paracetamol 500mg').closest('button') as HTMLElement;
    expect(row.textContent).toContain('คืน 2 ครั้ง');
    expect(screen.queryByText('Amoxicillin 500mg')).toBeNull();
  });

  it('stays hidden when no drug has 2+ ADR-reason returns', async () => {
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PARACETAMOL, AMOXICILLIN]);
    fireCollection('lots', []);
    fireCollection('txs', TXS.slice(2)); // only one ADR return each, no repeats

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '🧠 วิเคราะห์อัตโนมัติ' }));
    await screen.findByText(/คำนวณจากสถิติการใช้ยา/);
    expect(screen.queryByText('🩺 ยาที่มีรายงานแพ้ยา/ผลข้างเคียงซ้ำ')).toBeNull();
  });
});
