// A med deactivated on another device while this screen still shows its row: the single-row count buttons used to write to it anyway
// (only the "บันทึกทั้งหมด" bulk path had the active check).
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';
import { asMedId } from '../types';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: false, parSub: 500, parFloor: 100, floor: 40, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness() {
  const { setCountInput, commitCount, setSubCountInput, commitSubCount } = useApp();
  useEffect(() => { setCountInput(MED.id, '10'); setSubCountInput(MED.id, '10'); }, [setCountInput, setSubCountInput]);
  return <><button onClick={() => commitCount(MED.id)}>count-floor</button><button onClick={() => commitSubCount(MED.id)}>count-sub</button></>;
}

describe('single-row count on a deactivated med', () => {
  for (const [label, name] of [['floor', 'count-floor'], ['substock', 'count-sub']] as const) {
    it(`${label} count toasts and writes nothing`, async () => {
      const user = userEvent.setup();
      renderWithApp(<><Harness /><Toast /></>);
      await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
      await waitFor(() => expect(hasListener('meds')).toBe(true));
      fireCollection('meds', [MED]);
      await user.click(await screen.findByRole('button', { name }));
      await screen.findByText(/ยานี้ถูกปิดใช้งานแล้ว/);
      expect(getLastTransactionWrites().length).toBe(0);
    });
  }
});
