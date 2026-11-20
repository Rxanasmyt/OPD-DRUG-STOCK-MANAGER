// คืนยา: duplicate warning + cancel (reversal) of today's returns + the grouped reason chips.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdjustScreen from './AdjustScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';
import { RETURN_REASONS, RETURN_REASON_GROUPS, REVERSAL_PREFIX, ADR_RETURN_REASON, netReturnRecords, reversedIds } from '../utils/returnReasons';
import type { DrugReturnRecord } from '../types';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0,
};
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const rec = (o: Partial<DrugReturnRecord>): DrugReturnRecord => ({
  id: 'r1', medId: 'm1', medName: MED.name, medCode: MED.code, unit: 'เม็ด', category: 'x', hn: '1234567', qty: 10, unitPrice: 2, value: 20,
  reason: 'ไม่ประสงค์รับยา', note: '—', date: today, ts: Date.now() - 60000, by: 'ทดสอบ', ...o,
});

function Harness() { return (<><AdjustScreen /><ConfirmDialog /></>); }
async function setup(returnsToday: DrugReturnRecord[]) {
  const user = userEvent.setup();
  renderWithApp(<Harness />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  seedDoc('meds/m1', { floor: 40 });
  seedCollection('returns', returnsToday.map((r) => ({ ...r })));
  await user.click(screen.getByRole('button', { name: /^คืนยา/ }));
  return user;
}

describe('return reasons', () => {
  it('are grouped, complete, unique, and keep the stored ADR string byte-identical', () => {
    expect(RETURN_REASONS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RETURN_REASONS).size).toBe(RETURN_REASONS.length);
    expect(RETURN_REASON_GROUPS.length).toBeGreaterThanOrEqual(5);
    expect(ADR_RETURN_REASON).toBe('แพ้ยา/ผลข้างเคียงการรักษา');
    for (const old of ['ปรับเปลี่ยนการรักษา', 'Non-compliance', 'ได้ยาเกินจากวันนัดรอบก่อน', 'ไม่ประสงค์รับยา', 'ยาตามอาการเหลือ', 'ยาโรคเรื้อรังเหลือเยอะ']) expect(RETURN_REASONS).toContain(old);
  });
  it('netReturnRecords counts a reversal row negative and reversedIds links it to the original', () => {
    const orig = rec({ id: 'r1' });
    const rev = rec({ id: 'r2', reason: REVERSAL_PREFIX + orig.reason, note: '#r1 · หักยอดหน้างานจริง 10 เม็ด' });
    expect(reversedIds([orig, rev]).has('r1')).toBe(true);
    const net = netReturnRecords([orig, rev]);
    expect(net.reduce((s, r) => s + r.value, 0)).toBe(0);
  });
});

describe('AdjustScreen — คืนยา cancel + duplicate warning', () => {
  it('lists today\'s returns by HN and cancelling one writes a reversal (−qty tx, +reversal returns row, floor back down)', async () => {
    const user = await setup([rec({})]);
    const panel = await screen.findByTestId('today-returns');
    await user.click(within(panel).getByRole('button', { name: /รายการคืนวันนี้/ }));
    expect(within(panel).getByText('👤 HN 1234567')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /ยกเลิกรายการคืน Paracetamol/ }));
    await user.click(await screen.findByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ|ใช่/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const writes = getLastTransactionWrites();
    const floorW = writes.find((w) => 'floor' in (w.data as object))!.data as { floor: number };
    expect(floorW.floor).toBe(30); // 40 − 10 returned
    const tx = writes.find((w) => (w.data as { type?: string }).type === 'return')!.data as { qty: number; reason: string; note: string };
    expect(tx.qty).toBe(-10);
    expect(tx.reason).toBe(REVERSAL_PREFIX + 'ไม่ประสงค์รับยา');
    expect(tx.note).toContain('#r1');
    const retRow = writes.find((w) => w.path.startsWith('returns/'))!.data as { reason: string; qty: number; note: string };
    expect(retRow.reason).toBe(REVERSAL_PREFIX + 'ไม่ประสงค์รับยา');
    expect(retRow.qty).toBe(10); // non-negative (firestore.rules); the report nets it negative
    expect(retRow.note).toContain('#r1');
  });

  it('never takes the floor below 0 when the shelf was already used since the return', async () => {
    const user = await setup([rec({ qty: 60, value: 120 })]);
    const panel = await screen.findByTestId('today-returns');
    await user.click(within(panel).getByRole('button', { name: /รายการคืนวันนี้/ }));
    await user.click(within(panel).getByRole('button', { name: /ยกเลิกรายการคืน Paracetamol/ }));
    await user.click(await screen.findByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ|ใช่/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const writes = getLastTransactionWrites();
    expect((writes.find((w) => 'floor' in (w.data as object))!.data as { floor: number }).floor).toBe(0);
    expect((writes.find((w) => (w.data as { type?: string }).type === 'return')!.data as { qty: number }).qty).toBe(-40); // only what was really there
  });

  it('an already-cancelled return shows "ยกเลิกแล้ว" and offers no second cancel', async () => {
    const orig = rec({ id: 'r1' });
    const rev = rec({ id: 'r2', reason: REVERSAL_PREFIX + orig.reason, note: '#r1 · หักยอดหน้างานจริง 10 เม็ด' });
    const user = await setup([orig, rev]);
    const panel = await screen.findByTestId('today-returns');
    await user.click(within(panel).getByRole('button', { name: /รายการคืนวันนี้/ }));
    expect(within(panel).getByText('ยกเลิกแล้ว')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /ยกเลิกรายการคืน/ })).not.toBeInTheDocument();
  });

  it('warns before saving the same drug for the same HN again today', async () => {
    const user = await setup([rec({})]);
    await user.type(await screen.findByPlaceholderText('เช่น 1234567'), '1234567');
    await user.type(await screen.findByPlaceholderText('ค้นหาชื่อยา'), 'Paracetamol');
    await user.click(await screen.findByText(MED.name));
    const qtyLabel = screen.getByText(/จำนวนที่คืน/).closest('label') as HTMLElement;
    await user.type(within(qtyLabel).getByRole('textbox'), '5');
    await user.click(screen.getByRole('button', { name: 'ไม่ประสงค์รับยา' }));
    await user.click(screen.getByRole('button', { name: 'บันทึกรับคืน' }));
    expect(await screen.findByText(/เพิ่งคืน Paracetamol500mg|เพิ่งคืน Paracetamol 500mg/)).toBeInTheDocument();
  });
});
void vi;
