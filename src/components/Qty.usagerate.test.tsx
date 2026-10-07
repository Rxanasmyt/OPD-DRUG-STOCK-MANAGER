// Regression tests for UsageRateBadge — real-world request: "อยากให้ที่หัวมุมรายการยาทุกตัวให้มี
// ข้อมูลว่ายาตัวนี้ 1 วันใช้ยาจำนวนยาเท่าไร โดยใช้ข้อมูลที่คำนวณมาได้ที่ใช้สำหรับคำนวน min max par
// เลยครับ" — the badge must show the SAME daily rate parSuggestionDailyRate()/suggestPar() itself
// sizes Min/Max/par off of, not dailyUsageRate()'s plain single-month figure used elsewhere.
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UsageRateBadge } from './Qty';
import { parSuggestionDailyRate } from '../store/selectors';
import type { Med } from '../types';

const med = (over: Partial<Med> = {}): Med => ({
  id: 'm1', code: 'MED-0001', name: 'Test', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 1,
  ...over,
} as Med);

describe('UsageRateBadge', () => {
  it('renders nothing for a med with no real usage data yet (used30 <= 0)', () => {
    render(<UsageRateBadge m={med({ used30: 0 })} />);
    expect(screen.queryByText(/เม็ด\/วัน/)).not.toBeInTheDocument();
  });

  // One decimal place, formatted directly (not via nf(), which always rounds to a whole number
  // — see UsageRateBadge's own comment on why that would be wrong here).
  const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  it('shows the blended 70/30 rate (parSuggestionDailyRate), not the plain single-month dailyUsageRate, when a prior-month baseline exists', () => {
    const m = med({ used30: 1000, usedPrev30: 100 });
    const expectedRate = oneDecimal(parSuggestionDailyRate(m));
    // Plain used30/weekday-rate alone would be a visibly different (much higher) number —
    // asserting the actual blended figure, not just "some number", catches a regression where
    // this badge is wired to the wrong rate function.
    const naiveRate = oneDecimal(1000 / (30 * (5 / 7)));
    expect(expectedRate).not.toBe(naiveRate);
    render(<UsageRateBadge m={m} />);
    expect(screen.getByText('📊 ~' + expectedRate + ' เม็ด/วัน')).toBeInTheDocument();
  });

  it('falls back to the plain single-month rate when there is no prior-month baseline', () => {
    const m = med({ used30: 60, usedPrev30: 0 });
    const expectedRate = oneDecimal(parSuggestionDailyRate(m));
    render(<UsageRateBadge m={m} />);
    expect(screen.getByText('📊 ~' + expectedRate + ' เม็ด/วัน')).toBeInTheDocument();
  });
});
