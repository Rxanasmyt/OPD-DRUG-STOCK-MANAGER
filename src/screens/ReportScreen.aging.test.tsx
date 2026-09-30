// Regression test for a real performance/correctness fix found by audit: aging-bucket/riskValue
// used to look up each lot's med via meds.find() — a linear scan of the whole active-meds array
// PER LOT, across all 5 aging buckets plus riskValue, unmemoized (recomputed on every render,
// including an unrelated re-render like typing into the Discrepancy-log search box on another
// tab). Rewritten to use a medById Map (O(1) lookup, same fix categoryStats()/subQty() already
// use elsewhere) wrapped in useMemo. This test locks in that the per-bucket value/lot-count
// stays CORRECT across multiple meds with different prices sharing the same aging bucket — the
// exact case a medById-keying mistake (e.g. an off-by-one Map build) would get wrong even though
// a single-med test wouldn't catch it. See ReportScreen.tsx's own "Bug fix (performance)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 10, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const MED_B = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 3, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// Both land in the "31–90 วัน" bucket. MED_A: 20 units * 10 บาท = 200. MED_B: 15 units * 3 บาท =
// 45. Total should be 245 บาท across 2 lots — wrong if medById mismatches a lot to the wrong med.
const LOT_A = { id: 'l1', medId: 'm1', lotNo: 'LOT-A', qty: 20, exp: Date.now() + 60 * 86400000 };
const LOT_B = { id: 'l2', medId: 'm2', lotNo: 'LOT-B', qty: 15, exp: Date.now() + 60 * 86400000 };

describe('ReportScreen — aging-bucket value accuracy regression (medById rewrite)', () => {
  it('sums the correct per-bucket value across multiple meds with different prices', async () => {
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_A, MED_B]);
    fireCollection('lots', [LOT_A, LOT_B]);

    // reportTab defaults to 'aging'.
    await screen.findByText('31–90 วัน');
    const row = screen.getByText('31–90 วัน').closest('div')!.parentElement as HTMLElement;
    await screen.findByText('2 lot · 245 บาท');
    expect(row).toBeInTheDocument();
  });
});
