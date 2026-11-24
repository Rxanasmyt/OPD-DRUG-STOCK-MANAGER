// A "นับหน้างาน" button on every เติมหน้างาน row jumps straight to counting that one med's floor stock.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import CountScreen from './CountScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const base = { unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true, parSub: 100, parFloor: 100, bin: 'A1', used30: 60, usedPrev30: 0, volatility: 0 };
const A = { ...base, id: 'a1', code: 'MED-0001', name: 'ALPHA DRUG 5 mg', floor: 10 };
const B = { ...base, id: 'b1', code: 'MED-0002', name: 'BRAVO DRUG 5 mg', floor: 20 };

function Switch() { const { state } = useApp(); return state.screen === 'count' ? <CountScreen /> : <TransferScreen />; }

describe('เติมหน้างาน → นับหน้างาน shortcut', () => {
  it('opens the count screen on the floor tab showing only that med, with its count box focused', async () => {
    const user = userEvent.setup();
    renderWithApp(<Switch />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [A, B]);
    fireCollection('lots', []);
    await screen.findByText(B.name);
    await user.click(screen.getByRole('button', { name: 'นับหน้างาน ' + B.name }));
    const box = await screen.findByLabelText('จำนวนที่นับได้ ' + B.name);
    await waitFor(() => expect(screen.queryByLabelText('จำนวนที่นับได้ ' + A.name)).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(box));
  });
});
