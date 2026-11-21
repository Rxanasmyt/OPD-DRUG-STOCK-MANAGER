import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CountScreen from './CountScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';
import { asMedId } from '../types';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'AMLODIPINE 10 mg เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1500, parFloor: 400, floor: 90, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0,
};
const LOT = { id: 'lotA', code: 'LOT-1', medId: 'm1', lotNo: 'A2609', exp: Date.now() + 400 * 86400000, qty: 1300 };

describe('CountScreen — entry guard UI', () => {
  it('shows which store is being counted, and warns LIVE (before saving) when the typed number matches the other store', async () => {
    const user = userEvent.setup();
    renderWithApp(<CountScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]); fireCollection('lots', [LOT]);
    const banner = await screen.findByTestId('count-scope');
    expect(banner).toHaveAttribute('data-loc', 'floor');
    expect(banner).toHaveTextContent('หน้างาน');
    const input = await screen.findByLabelText('จำนวนที่นับได้ ' + MED.name);
    await user.type(input, '1300');
    const warn = await screen.findByTestId('entry-warn');
    expect(warn).toHaveAttribute('data-severity', 'stop');
    expect(warn).toHaveTextContent('substock');
    await user.clear(input); await user.type(input, '88');
    await waitFor(() => expect(screen.queryByTestId('entry-warn')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'นับ substock' }));
    expect(screen.getByTestId('count-scope')).toHaveAttribute('data-loc', 'sub');
  });
});
