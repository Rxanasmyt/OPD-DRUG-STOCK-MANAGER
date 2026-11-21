// Undo of เติมหน้างาน / รับเข้า (reverseMove): lot provenance comes from the original tx note.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import ConfirmDialog from '../components/ConfirmDialog';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';
import { asMedId } from '../types';
import { REVERSAL_PREFIX } from '../utils/returnReasons';
import { transferNote } from '../utils/moveUndo';
import { expLabel } from '../utils/format';

const EXP = Date.UTC(2027, 4, 31);
const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'AMLODIPINE 10 mg เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1500, parFloor: 400, floor: 100, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0,
};
const now = Date.now();
const TRANSFER = { id: 'tr1', type: 'transfer_to_floor', name: MED.name, medId: 'm1', qty: 60, unit: 'เม็ด', from: 'substock', to: 'floor', note: transferNote([{ lotNo: 'A1', exp: EXP, take: 60 }]), by: 'ทดสอบ ภก.', ts: now - 600000 };
const RECEIVE = { id: 'rc1', type: 'receive_from_central', name: MED.name, medId: 'm1', qty: 500, unit: 'เม็ด', from: 'คลังยาใหญ่', to: 'substock', note: 'ใบเบิก R1 · lot A1 exp ' + expLabel(EXP), by: 'ทดสอบ ภก.', ts: now - 600000 };

function Harness({ id }: { id: string }) {
  const { state, reverseMove } = useApp();
  const tx = state.txs.find((t) => t.id === id);
  return <button onClick={() => tx && reverseMove(tx)} disabled={!tx}>undo</button>;
}
async function boot(id: string, txs: Record<string, unknown>[], opts: { floor: number; floorLotQty?: number; subLotQty: number }) {
  renderWithApp(<><Harness id={id} /><ConfirmDialog /><Toast /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [{ ...MED, floor: opts.floor }]);
  fireCollection('txs', txs);
  seedDoc('meds/m1', { floor: opts.floor });
  seedDoc('lots/lotA', { medId: 'm1', lotNo: 'A1', exp: EXP, qty: opts.subLotQty });
  seedCollection('lots', [{ id: 'lotA', medId: 'm1', lotNo: 'A1', exp: EXP, qty: opts.subLotQty }]);
  seedDoc('floorLots/m1__A1__' + EXP, { medId: 'm1', lotNo: 'A1', exp: EXP, qty: opts.floorLotQty ?? 0 });
}
const confirm = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ|ใช่/ }));

describe('reverseMove — transfer', () => {
  it('puts stock back into the SAME lots and appends two reversal rows', async () => {
    const user = userEvent.setup();
    await boot('tr1', [TRANSFER], { floor: 100, floorLotQty: 80, subLotQty: 10 });
    await user.click(screen.getByRole('button', { name: 'undo' }));
    await confirm(user);
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const w = getLastTransactionWrites();
    expect(w.find((x) => x.path === 'meds/m1')!.data).toMatchObject({ floor: 40 });
    expect(w.find((x) => x.path === 'floorLots/m1__A1__' + EXP)!.data).toMatchObject({ qty: 20 });
    expect(w.find((x) => x.path === 'lots/lotA')!.data).toMatchObject({ qty: 70 });
    const rows = w.filter((x) => (x.data as { type?: string }).type === 'count').map((x) => x.data as { qty: number; loc: string; reason: string; note: string });
    expect(rows.map((r) => [r.loc, r.qty]).sort()).toEqual([['floor', -60], ['substock', 60]]);
    expect(rows.every((r) => r.reason === REVERSAL_PREFIX + 'เติมหน้างาน' && r.note.startsWith('#tr1'))).toBe(true);
  });
  it('refuses (writes nothing) when the shelf already used the stock', async () => {
    const user = userEvent.setup();
    await boot('tr1', [TRANSFER], { floor: 100, floorLotQty: 25, subLotQty: 10 });
    await user.click(screen.getByRole('button', { name: 'undo' }));
    await confirm(user);
    await screen.findByText(/ยกเลิกไม่ได้/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
  it('refuses an old-format note instead of guessing the lots', async () => {
    const user = userEvent.setup();
    await boot('tr1', [{ ...TRANSFER, note: 'FEFO lot A1 (60)' }], { floor: 100, floorLotQty: 80, subLotQty: 10 });
    await user.click(screen.getByRole('button', { name: 'undo' }));
    await screen.findByText(/อ่านข้อมูล lot ของรายการนี้ไม่ได้/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
  it('refuses a move older than 24 h or already cancelled', async () => {
    const user = userEvent.setup();
    await boot('tr1', [{ ...TRANSFER, ts: now - 26 * 3600000 }], { floor: 100, floorLotQty: 80, subLotQty: 10 });
    await user.click(screen.getByRole('button', { name: 'undo' }));
    await screen.findByText(/เก่ากว่า 24 ชั่วโมง/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
});

describe('reverseMove — receive', () => {
  it('takes the received qty back out of the same lot', async () => {
    const user = userEvent.setup();
    await boot('rc1', [RECEIVE], { floor: 100, subLotQty: 800 });
    await user.click(screen.getByRole('button', { name: 'undo' }));
    await confirm(user);
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const w = getLastTransactionWrites();
    expect(w.find((x) => x.path === 'lots/lotA')!.data).toMatchObject({ qty: 300 });
    const row = w.find((x) => (x.data as { type?: string }).type === 'count')!.data as { qty: number; loc: string; reason: string };
    expect(row).toMatchObject({ qty: -500, loc: 'substock', reason: REVERSAL_PREFIX + 'รับเข้า' });
  });
  it('refuses when part of that lot has already gone to the shelf', async () => {
    const user = userEvent.setup();
    await boot('rc1', [RECEIVE], { floor: 100, subLotQty: 200 });
    await user.click(screen.getByRole('button', { name: 'undo' }));
    await confirm(user);
    await screen.findByText(/ยกเลิกไม่ได้/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
});
