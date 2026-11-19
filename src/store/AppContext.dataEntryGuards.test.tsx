// Data-entry safety nets: deducting more than the floor holds, a blank unit, and re-labelling the
// unit / pack size / substock flag of a med that holds stock must each ask (or refuse) before writing.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { asMedId } from '../types';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0, noSubstock: true,
};
const FORM = (over: Record<string, unknown> = {}) => ({
  name: MED.name, unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, bin: 'A1', parSub: 500, parFloor: 100, floorMin: 50,
  ward: 'opd' as const, noSubstock: true, volatility: 1, ...over,
});

function Harness() {
  const { state, confirmAsync: _c, respondConfirm, pickAdjType, pickAdjMed, setAdjQty, setAdjReason, commitAdjust, updateMedFull, addMed } = useApp() as unknown as ReturnType<typeof useApp> & { confirmAsync?: unknown };
  void _c;
  useEffect(() => { if (!state.adjType) pickAdjType('damaged'); }, [state.adjType, pickAdjType]);
  useEffect(() => { if (state.adjType && !state.adjMed) pickAdjMed(MED.id); }, [state.adjType, state.adjMed, pickAdjMed]);
  useEffect(() => { if (state.adjMed && !state.adjQty) setAdjQty('100'); }, [state.adjMed, state.adjQty, setAdjQty]);
  useEffect(() => { if (state.adjQty && !state.adjReason) setAdjReason('ชำรุด'); }, [state.adjQty, state.adjReason, setAdjReason]);
  return (
    <>
      <div data-testid="confirm">{state.confirmDialog ? (state.confirmDialog as { message?: string }).message ?? 'open' : 'none'}</div>
      <button onClick={() => respondConfirm(true)}>yes</button>
      <button onClick={() => respondConfirm(false)}>no</button>
      <button disabled={!state.adjReason} onClick={commitAdjust}>commit-adjust</button>
      <button onClick={() => void updateMedFull(MED.id, FORM({ unit: 'ขวด' }), null)}>save-unit-change</button>
      <button onClick={() => void updateMedFull(MED.id, FORM({ unit: '  ' }), null)}>save-blank-unit</button>
      <button onClick={() => void addMed({ ...FORM({ unit: '' }), parSub: 0, parFloor: 10, floorMin: 5 })}>add-blank-unit</button>
    </>
  );
}

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<Harness />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  return user;
}

describe('data-entry safety nets', () => {
  it('asks before deducting more than the floor holds, naming the real applied amount; "no" writes nothing', async () => {
    const user = await setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-adjust' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'commit-adjust' }));
    await waitFor(() => expect(screen.getByTestId('confirm').textContent).toContain('ระบบจะตัดได้จริงแค่ 40'));
    await user.click(screen.getByRole('button', { name: 'no' }));
    expect(getLastTransactionWrites()).toHaveLength(0);
  });

  it('refuses to save a blank unit (add and edit) instead of storing the placeholder "หน่วย"', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'add-blank-unit' }));
    await user.click(screen.getByRole('button', { name: 'save-blank-unit' }));
    expect(getLastTransactionWrites()).toHaveLength(0);
    expect(screen.getByTestId('confirm').textContent).toBe('none');
  });

  it('asks before re-labelling the unit of a med that holds stock (numbers are not converted)', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'save-unit-change' }));
    await waitFor(() => expect(screen.getByTestId('confirm').textContent).toContain('หน่วย "เม็ด" → "ขวด"'));
    expect(screen.getByTestId('confirm').textContent).toContain('ตัวเลขจะไม่ถูกแปลงให้');
  });
});
