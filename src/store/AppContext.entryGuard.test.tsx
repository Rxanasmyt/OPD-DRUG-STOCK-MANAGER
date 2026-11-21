// Entry guard wiring (count mix-up warning) + cancel of a recent count (reverseCount).
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import ConfirmDialog from '../components/ConfirmDialog';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';
import { asMedId } from '../types';
import { REVERSAL_PREFIX } from '../utils/returnReasons';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'AMLODIPINE 10 mg เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1500, parFloor: 400, floor: 90, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0,
};
const LOT = { id: 'lotA', code: 'LOT-1', medId: 'm1', lotNo: 'A2609', exp: Date.now() + 400 * 86400000, qty: 1300 };

function CountHarness({ value }: { value: string }) {
  const { setCountInput, commitCount } = useApp();
  useEffect(() => { setCountInput(asMedId('m1'), value); }, [setCountInput, value]);
  return <button onClick={() => commitCount(asMedId('m1'))}>commit-count</button>;
}
function ReverseHarness() {
  const { state, reverseCount } = useApp();
  const tx = state.txs.find((t) => t.type === 'count');
  return <button onClick={() => tx && reverseCount(tx)} disabled={!tx}>reverse</button>;
}
async function boot(ui: React.ReactElement, txs: Record<string, unknown>[] = []) {
  renderWithApp(<>{ui}<ConfirmDialog /><Toast /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  fireCollection('lots', [LOT]);
  seedDoc('meds/m1', { floor: 90 });
  seedDoc('lots/lotA', { qty: 1300, lotNo: 'A2609', exp: LOT.exp });
  seedCollection('lots', [LOT]);
  if (txs.length) fireCollection('txs', txs);
}

describe('count entry guard', () => {
  it('stops a floor count that is really the substock number, and blocks the save when cancelled', async () => {
    const user = userEvent.setup();
    await boot(<CountHarness value="1300" />);
    await user.click(screen.getByRole('button', { name: 'commit-count' }));
    await screen.findByText(/ใกล้เคียงยอดsubstock|ใกล้เคียงยอด.*substock/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(getLastTransactionWrites().length).toBe(0);
  });
  it('saves normally when the count is plausible (no prompt)', async () => {
    const user = userEvent.setup();
    await boot(<CountHarness value="88" />);
    await user.click(screen.getByRole('button', { name: 'commit-count' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(screen.queryByText(/ตรวจก่อนบันทึก|น่าจะผิด/)).not.toBeInTheDocument();
  });
});

const MY_COUNT = { id: 'tx1', type: 'count', name: MED.name, medId: 'm1', qty: 1210, unit: 'เม็ด', reason: 'นับสต็อกหน้างานประจำรอบ', note: 'x', loc: 'floor', by: 'ทดสอบ ภก.', ts: Date.now() - 600000 };

describe('reverseCount', () => {
  it('floor count: puts the floor back by the counted delta, as an appended reversal row', async () => {
    const user = userEvent.setup();
    seedDoc('meds/m1', { floor: 1300 });
    await boot(<ReverseHarness />, [MY_COUNT]);
    seedDoc('meds/m1', { floor: 1300 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'reverse' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'reverse' }));
    await user.click(await screen.findByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ|ใช่/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const w = getLastTransactionWrites();
    expect((w.find((x) => 'floor' in (x.data as object))!.data as { floor: number }).floor).toBe(90);
    const tx = w.find((x) => (x.data as { type?: string }).type === 'count')!.data as { qty: number; reason: string; note: string };
    expect(tx.qty).toBe(-1210);
    expect(tx.reason).toBe(REVERSAL_PREFIX + 'นับสต็อกหน้างานประจำรอบ');
    expect(tx.note.startsWith('#tx1')).toBe(true);
  });
  it('never takes the floor below 0', async () => {
    const user = userEvent.setup();
    await boot(<ReverseHarness />, [MY_COUNT]);
    seedDoc('meds/m1', { floor: 500 }); // shelf already used since the count
    await user.click(screen.getByRole('button', { name: 'reverse' }));
    await user.click(await screen.findByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ|ใช่/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const w = getLastTransactionWrites();
    expect((w.find((x) => 'floor' in (x.data as object))!.data as { floor: number }).floor).toBe(0);
    expect((w.find((x) => (x.data as { type?: string }).type === 'count')!.data as { qty: number }).qty).toBe(-500);
  });
  it('refuses a substock count that REMOVED stock (cut from real lots)', async () => {
    const user = userEvent.setup();
    await boot(<ReverseHarness />, [{ ...MY_COUNT, loc: 'substock', qty: -200 }]);
    await user.click(screen.getByRole('button', { name: 'reverse' }));
    await screen.findByText(/ยกเลิกอัตโนมัติไม่ได้/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
  it('substock count that ADDED stock is taken back out of the adjust lot only', async () => {
    const user = userEvent.setup();
    const adjLot = { id: 'lotAdj', code: 'LOT-2', medId: 'm1', lotNo: 'ปรับยอด (นับสต็อก)', exp: Date.now() + 3e12, qty: 150 };
    await boot(<ReverseHarness />, [{ ...MY_COUNT, loc: 'substock', qty: 100 }]);
    fireCollection('lots', [LOT, adjLot]);
    seedCollection('lots', [LOT, adjLot]);
    seedDoc('lots/lotAdj', { qty: 150, lotNo: 'ปรับยอด (นับสต็อก)', exp: adjLot.exp });
    await user.click(screen.getByRole('button', { name: 'reverse' }));
    await user.click(await screen.findByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ|ใช่/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const w = getLastTransactionWrites();
    const lotW = w.find((x) => x.path === 'lots/lotAdj')!.data as { qty: number };
    expect(lotW.qty).toBe(50);
    expect(w.some((x) => x.path === 'lots/lotA')).toBe(false); // real lots untouched
  });
  it('does nothing for a count older than 24h', async () => {
    const user = userEvent.setup();
    await boot(<ReverseHarness />, [{ ...MY_COUNT, ts: Date.now() - 30 * 3600000 }]);
    await user.click(screen.getByRole('button', { name: 'reverse' }));
    await screen.findByText(/เก่ากว่า 24 ชั่วโมง/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
});
