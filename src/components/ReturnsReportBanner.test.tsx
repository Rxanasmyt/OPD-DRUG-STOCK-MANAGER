// "รายงานคืนยาเดือน… พร้อมแล้ว" banner: shown on home until this device opens the previous month's report.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReturnsReportBanner from './ReturnsReportBanner';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';
import { getSeenReturnsMonth, markReturnsMonthSeen, takeReturnsDeepLink } from '../utils/deepLink';
import { monthLabelTh, previousMonth } from '../utils/returnsSummary';

function Probe() { const { state, go } = useApp(); return <><div data-testid="screen">{state.screen}</div><div data-testid="tab">{state.reportTab}</div><button onClick={() => go('home')}>go-home</button></>; }
const NOW = Date.parse('2026-11-02T03:00:00Z'); // Mon 2 Nov 2026, 10:00 Bangkok → previous month = 2026-10

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

async function boot() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  renderWithApp(<><ReturnsReportBanner /><Probe /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', []);
}

describe('month helpers', () => {
  it('previousMonth uses the Bangkok calendar; Thai label uses the Buddhist year', () => {
    expect(previousMonth(NOW)).toBe('2026-10');
    expect(previousMonth(Date.parse('2026-01-15T00:00:00Z'))).toBe('2025-12');
    expect(previousMonth(Date.parse('2026-11-30T17:30:00Z'))).toBe('2026-11'); // already 1 Dec in Bangkok
    expect(monthLabelTh('2026-10')).toBe('ตุลาคม 2569');
  });
  it('"seen" only ever moves forward', () => {
    markReturnsMonthSeen('2026-10'); markReturnsMonthSeen('2026-09'); markReturnsMonthSeen('garbage');
    expect(getSeenReturnsMonth()).toBe('2026-10');
  });
});

describe('ReturnsReportBanner', () => {
  it('shows on the home screen with the month name, and tapping it opens the returns report and marks it seen', async () => {
    await boot();
    const b = await screen.findByTestId('returns-report-banner');
    expect(b).toHaveTextContent('รายงานคืนยาเดือนตุลาคม 2569 พร้อมแล้ว');
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole('button', { name: /ดูรายงาน/ }));
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('report'));
    expect(screen.getByTestId('tab')).toHaveTextContent('returns');
    expect(getSeenReturnsMonth()).toBe('2026-10');
    expect(takeReturnsDeepLink()).toEqual({ month: '2026-10', view: 'all' }); // ReportScreen will load that month
    // back on home: gone for good on this device
    await user.click(screen.getByRole('button', { name: 'go-home' }));
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('home'));
    expect(screen.queryByTestId('returns-report-banner')).not.toBeInTheDocument();
  });

  it('stays hidden when this device already opened that month (e.g. from the LINE link)', async () => {
    markReturnsMonthSeen('2026-10');
    await boot();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('returns-report-banner')).not.toBeInTheDocument();
  });

  it('comes back next month', async () => {
    markReturnsMonthSeen('2026-10');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-12-01T03:00:00Z'));
    renderWithApp(<><ReturnsReportBanner /><Probe /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    expect(await screen.findByTestId('returns-report-banner')).toHaveTextContent('พฤศจิกายน 2569');
  });

  it('opening the report from the LINE deep link also counts as seen', () => {
    sessionStorage.setItem('opd-returns-deeplink', JSON.stringify({ month: '2026-10', view: 'reason' }));
    expect(takeReturnsDeepLink()).toEqual({ month: '2026-10', view: 'reason' });
    expect(getSeenReturnsMonth()).toBe('2026-10');
  });
});
