// Regression test for a real request: "ทำอย่างไรให้แอพมีความเสถียรที่สุดเหมือนโปรแกรม Hosxp...
// ดูย้อนหลังได้เสมอ" — the new "📜 ยอดคงคลังย้อนหลัง" tab fetches a reconstructed point-in-time
// stock snapshot (see AppContext.stockAsOf.test.tsx for the reconstruction math itself) and
// renders it as a searchable table. This locks in that the fetched rows actually reach the
// screen and render, through the real AppProvider/useApp() plumbing.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};
const MED_B = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A2',
  noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};

describe('ReportScreen — stockasof tab regression', () => {
  it('fetches and renders a point-in-time stock snapshot for today by default, searchable by name', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_A, MED_B]);
    fireCollection('lots', []);
    seedCollection('txs', []);

    // Auto-fetches on tab open (same pattern as the kpi/usage tabs) — no need to press
    // "ดึงยอดคงคลัง" for the default (today's) date.
    await user.click(screen.getByRole('button', { name: '📜 ยอดคงคลังย้อนหลัง' }));

    await screen.findByText(MED_A.name);
    expect(screen.getByText(MED_B.name)).toBeInTheDocument();

    const search = screen.getByPlaceholderText('ค้นหาชื่อยา');
    await user.type(search, 'Paracetamol');
    expect(screen.queryByText(MED_A.name)).not.toBeInTheDocument();
    expect(screen.getByText(MED_B.name)).toBeInTheDocument();
  });
});
