// Regression test for a real request: "ควรมีกราฟมั้ย หรือแผนภูมิ" — บัตรสต็อก now shows a
// screen-only balance-trend sparkline (BalanceTrendChart in SubstockCardScreen.tsx) alongside
// the existing real-time balance/ledger table, plotting the SAME viewRows the ledger table and
// period-total tiles already use, colored in the same tone the live-balance number already
// uses. Verifies the chart renders once there's enough history, and that hovering a point shows
// its exact date+balance (the numbers the compact line itself can't show directly).
import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubstockCardScreen from './SubstockCardScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

// jsdom does no real layout — clientWidth is always 0, so the chart's own ResizeObserver-based
// width measurement (see BalanceTrendChart's `measure()`) would never see a non-zero width and
// the <svg> (gated on `width > 0`) would never render at all. A fixed stub here is the same
// class of fix as test-setup.ts's own ResizeObserver stub for LabelsScreen's AutoFitText.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 300 });

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const now = Date.now();
// Three substock movements this fiscal year, building a real up-then-down balance trend:
// +100 -> 100, +50 -> 150, -30 (transfer_to_floor) -> 120.
const TXS = [
  { id: 't1', type: 'receive_from_central', name: MED.name, medId: 'm1', ts: now - 20 * 86400000, qty: 100, by: 'ทดสอบ ภก.', to: 'substock' },
  { id: 't2', type: 'receive_from_central', name: MED.name, medId: 'm1', ts: now - 10 * 86400000, qty: 50, by: 'ทดสอบ ภก.', to: 'substock' },
  { id: 't3', type: 'transfer_to_floor', name: MED.name, medId: 'm1', ts: now - 5 * 86400000, qty: 30, by: 'ทดสอบ ภก.' },
];

async function openCard() {
  const user = userEvent.setup();
  renderWithApp(<SubstockCardScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  fireCollection('lots', []);
  seedCollection('txs', TXS);

  await user.type(screen.getByPlaceholderText('ค้นหาชื่อยา'), 'Amoxicillin');
  await user.click(await screen.findByText(MED.name));
  return user;
}

describe('SubstockCardScreen — balance trend chart regression', () => {
  it('shows the trend chart once the med has at least 2 history rows this period', async () => {
    await openCard();
    await screen.findByText('แนวโน้มยอดคงเหลือ');
    // 3 rows plotted -> a line path exists with 3 points worth of drawing.
    const svg = document.querySelector('svg[width="100%"]') as SVGSVGElement;
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector('path[fill="none"]')).toBeInTheDocument();
  });

  it('shows the hovered point\'s exact date and balance in a tooltip', async () => {
    await openCard();
    await screen.findByText('แนวโน้มยอดคงเหลือ');
    const svg = document.querySelector('svg[width="100%"]') as SVGSVGElement;

    // jsdom has no real layout, so getBoundingClientRect() on the chart wrapper is a mocked
    // stub unless overridden — force a known width so pointerToIndex's math resolves to a
    // deterministic point (the middle one, balance 150) instead of always landing on 0.
    const wrap = svg.parentElement as HTMLElement;
    wrap.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 72, width: 300, height: 72, x: 0, y: 0, toJSON: () => ({}) });

    fireEvent.pointerMove(svg, { clientX: 150 });
    await screen.findByText('150 เม็ด');
  });
});
