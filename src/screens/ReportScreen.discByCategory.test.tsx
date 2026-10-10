// Regression test for a real request: "หมวดไหนเสียบ่อยผิดปกติ (อาจบ่งชี้ปัญหา process ไม่ใช่แค่
// สุ่ม)" — the "🧠 วิเคราะห์อัตโนมัติ" tab's new "📦 หมวดยาที่มีรายการผิดปกติบ่อย" block sums the
// Discrepancy log (adjust/return/damaged/expired/count/reconcile_hosxp) by drug category — a
// pattern a reader skimming the flat, row-at-a-time Discrepancy-log tab would never notice on
// their own. See selectors.ts's own discrepancyByCategory (unit-tested there) — this test locks
// in the UI wiring through the real AppProvider/useApp() plumbing specifically.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

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
// Paracetamol (ยาแก้ปวด/ลดไข้/ต้านอักเสบ (NSAID)) gets 3 of the 4 total rows (75%) — well past
// the ≥40% "flag it red" threshold the block shares with usageAnomalies elsewhere on this tab.
const TXS = [
  { id: 't1', medId: 'm1', name: PARACETAMOL.name, type: 'adjust', qty: -5, unit: 'เม็ด', by: 'ทดสอบ ภก.', ts: Date.now() - 1000, reason: 'นับไม่ตรง' },
  { id: 't2', medId: 'm1', name: PARACETAMOL.name, type: 'adjust', qty: -3, unit: 'เม็ด', by: 'ทดสอบ ภก.', ts: Date.now() - 2000, reason: 'นับไม่ตรง' },
  { id: 't3', medId: 'm1', name: PARACETAMOL.name, type: 'expired', qty: -10, unit: 'เม็ด', by: 'ทดสอบ ภก.', ts: Date.now() - 3000, reason: 'หมดอายุ' },
  { id: 't4', medId: 'm2', name: AMOXICILLIN.name, type: 'damaged', qty: -2, unit: 'แคปซูล', by: 'ทดสอบ ภก.', ts: Date.now() - 4000, reason: 'ขวดแตก' },
];

describe('ReportScreen — discrepancy-by-category pattern insight regression', () => {
  it('shows the category with the most discrepancy rows first, flagged when its share is ≥40%, with a type breakdown', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PARACETAMOL, AMOXICILLIN]);
    fireCollection('lots', []);
    fireCollection('txs', TXS);

    await user.click(screen.getByRole('button', { name: '🧠 วิเคราะห์อัตโนมัติ' }));

    await screen.findByText('📦 หมวดยาที่มีรายการผิดปกติบ่อย');
    const painLabel = screen.getByText('ยาแก้ปวด/ลดไข้/ต้านอักเสบ (NSAID)');
    const painRow = painLabel.closest('div')!.parentElement as HTMLElement;
    expect(painRow.textContent).toContain('3 ครั้ง (75%)');
    expect(painRow.textContent).toContain('ปรับยอด 2');
    expect(painRow.textContent).toContain('หมดอายุ 1');

    const amoxLabel = screen.getByText('ยาต้านจุลชีพ (ปฏิชีวนะ/เชื้อรา/ไวรัส)');
    const amoxRow = amoxLabel.closest('div')!.parentElement as HTMLElement;
    expect(amoxRow.textContent).toContain('1 ครั้ง (25%)');
    expect(amoxRow.textContent).toContain('ยาเสีย/ชำรุด 1');
  });

  it('stays hidden when there are fewer than 3 discrepancy rows total, so a near-empty system never shows a hollow "top category"', async () => {
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PARACETAMOL]);
    fireCollection('lots', []);
    fireCollection('txs', TXS.slice(0, 2));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '🧠 วิเคราะห์อัตโนมัติ' }));
    // Confirms the insights tab's own content actually mounted (not just that the tab button
    // exists, which would be true regardless of which tab is active).
    await screen.findByText(/คำนวณจากสถิติการใช้ยา/);
    expect(screen.queryByText('📦 หมวดยาที่มีรายการผิดปกติบ่อย')).toBeNull();
  });
});
