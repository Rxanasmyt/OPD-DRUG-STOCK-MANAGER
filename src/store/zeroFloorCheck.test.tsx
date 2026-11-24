// A floor of 0 in the app is often a clamp artefact — flag it for a physical count until someone counts it today.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { needsZeroFloorCheck } from './selectors';
import type { Med } from '../types';
import TransferScreen from '../screens/TransferScreen';
import CountScreen from '../screens/CountScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const m = (o: Partial<Med>) => ({ id: 'm1', code: 'MED-1', name: 'X 5 mg', unit: 'เม็ด', active: true, floor: 0, parFloor: 100, used30: 50, usedPrev30: 0, ...o }) as unknown as Med;
const NOW = Date.parse('2026-11-24T10:00:00+07:00');

describe('needsZeroFloorCheck', () => {
  it('flags a stocked med that reads 0 and was not counted today', () => {
    expect(needsZeroFloorCheck(m({}), NOW)).toBe(true);
    expect(needsZeroFloorCheck(m({ lastCountTs: Date.parse('2026-11-20T10:00:00+07:00') }), NOW)).toBe(true);
  });
  it('is cleared by a count made today (even a count that confirms 0)', () => {
    expect(needsZeroFloorCheck(m({ lastCountTs: Date.parse('2026-11-24T08:30:00+07:00') }), NOW)).toBe(false);
  });
  it('ignores meds with stock, inactive meds, held meds, and meds nobody stocks or uses', () => {
    expect(needsZeroFloorCheck(m({ floor: 3 }), NOW)).toBe(false);
    expect(needsZeroFloorCheck(m({ active: false }), NOW)).toBe(false);
    expect(needsZeroFloorCheck(m({ outOfStockSince: NOW - 1000 } as Partial<Med>), NOW)).toBe(false);
    expect(needsZeroFloorCheck(m({ parFloor: 0, used30: 0 }), NOW)).toBe(false);
  });
});

const base = { unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true, parSub: 100, parFloor: 100, bin: 'A1', used30: 60, usedPrev30: 0, volatility: 0 };
const ZERO = { ...base, id: 'z1', code: 'MED-0001', name: 'ZERO DRUG 5 mg', floor: 0 };
const OKM = { ...base, id: 'o1', code: 'MED-0002', name: 'OKAY DRUG 5 mg', floor: 80 };

describe('zero-floor warnings in the screens', () => {
  it('Transfer: shows the "ตรวจนับจริงหรือยัง" badge only on the 0 row', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [ZERO, OKM]);
    fireCollection('lots', []);
    await screen.findByText(ZERO.name);
    expect(screen.getAllByTestId('zero-check')).toHaveLength(1);
  });
  it('Count: the "ยอด 0 ควรนับจริง" chip filters to just the 0 meds', async () => {
    const user = userEvent.setup();
    renderWithApp(<CountScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [ZERO, OKM]);
    fireCollection('lots', []);
    await screen.findByText(OKM.name);
    await user.click(await screen.findByTestId('zero-chip'));
    await waitFor(() => expect(screen.queryByText(OKM.name)).not.toBeInTheDocument());
    expect(screen.getByText(ZERO.name)).toBeInTheDocument();
  });
});
