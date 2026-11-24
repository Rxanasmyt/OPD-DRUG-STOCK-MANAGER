// Regression: a floor count (นับหน้างาน) lowered Med.floor but left the per-lot shelf batches (floorLots) untouched, so the
// transfer list kept showing "บนชั้น: lot X · เหลือ N" for stock the count had just proved is gone. The count now trims
// floorLots soonest-expiry-first down to the counted total (best-effort, only when the count is LOWER).
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedDoc, seedCollection, getAllTransactionLogs } from '../test-utils/firebaseTestDouble';
import { asMedId } from '../types';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness({ value }: { value: string }) {
  const { setCountInput, commitCount } = useApp();
  useEffect(() => { setCountInput(MED.id, value); }, [setCountInput, value]);
  return <button onClick={() => commitCount(MED.id)}>commit-count</button>;
}

async function run(value: string, floor = 40) {
  const user = userEvent.setup();
  const e1 = Date.now() + 30 * 86400000, e2 = Date.now() + 90 * 86400000;
  renderWithApp(<Harness value={value} />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [{ ...MED, floor }]);
  seedDoc('meds/m1', { floor });
  seedCollection('floorLots', [
    { id: 'm1__LB__' + e2, medId: 'm1', qty: 20, lotNo: 'LB', exp: e2 },
    { id: 'm1__LA__' + e1, medId: 'm1', qty: 30, lotNo: 'LA', exp: e1 },
  ]);
  seedDoc('floorLots/m1__LA__' + e1, { medId: 'm1', lotNo: 'LA', exp: e1, qty: 30 });
  seedDoc('floorLots/m1__LB__' + e2, { medId: 'm1', lotNo: 'LB', exp: e2, qty: 20 });
  await waitFor(() => expect(screen.getByRole('button', { name: 'commit-count' })).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'commit-count' }));
  return { e1, e2 };
}
const flWrites = () => getAllTransactionLogs().flatMap((l) => l.writes).filter((w) => w.path.startsWith('floorLots/'));

describe('floor count trims floorLots', () => {
  it('count below the lots total takes the excess from the soonest-expiry lot first', async () => {
    const { e1, e2 } = await run('10');
    await waitFor(() => expect(flWrites().length).toBeGreaterThan(0));
    const w = flWrites();
    expect(w.find((x) => x.path === 'floorLots/m1__LA__' + e1)?.data?.qty).toBe(0);
    expect(w.find((x) => x.path === 'floorLots/m1__LB__' + e2)?.data?.qty).toBe(10);
  });

  it('count that is not lower leaves floorLots alone', async () => {
    await run('60');
    await waitFor(() => expect(getAllTransactionLogs().length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(flWrites().length).toBe(0);
  });
});
