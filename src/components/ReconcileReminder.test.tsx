// "Forgot to attach yesterday's HOSxP file" — selector rules + the banner (window path and server-fallback path).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconcileReminder from './ReconcileReminder';
import { reconcileReminder } from '../store/selectors';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedCollection } from '../test-utils/firebaseTestDouble';

const at = (iso: string) => Date.parse(iso + '+07:00');

describe('reconcileReminder (pure)', () => {
  it('is ok when yesterday is already covered', () => {
    expect(reconcileReminder('2026-11-17', at('2026-11-18T10:00:00')).level).toBe('ok');
  });
  it('is "due" when exactly one working day is missing (from 08:00), not before', () => {
    expect(reconcileReminder('2026-11-16', at('2026-11-18T10:00:00'))).toMatchObject({ level: 'due', missingWeekdays: 1, lastMissingIso: '2026-11-17' });
    expect(reconcileReminder('2026-11-16', at('2026-11-18T07:00:00')).level).toBe('ok');
  });
  it('is "overdue" with 2+ missing working days, at any hour', () => {
    expect(reconcileReminder('2026-11-16', at('2026-11-19T06:00:00'))).toMatchObject({ level: 'overdue', missingWeekdays: 2, firstMissingIso: '2026-11-17', lastMissingIso: '2026-11-18' });
  });
  it('never counts a weekend: Monday morning after a Thursday file only misses Friday', () => {
    expect(reconcileReminder('2026-11-19', at('2026-11-23T10:00:00'))).toMatchObject({ level: 'due', missingWeekdays: 1, lastMissingIso: '2026-11-20' });
    expect(reconcileReminder('2026-11-20', at('2026-11-23T10:00:00')).level).toBe('ok'); // Friday's file covers Fri-Sun on Monday
  });
  it('does not nag on Saturday/Sunday, and never claims a delay when the last date is unknown', () => {
    expect(reconcileReminder('2026-11-13', at('2026-11-21T10:00:00')).level).toBe('ok');
    expect(reconcileReminder(null, at('2026-11-18T10:00:00')).level).toBe('ok');
  });
});

function GoProbe() { const { state } = useApp(); return <div data-testid="screen">{state.screen}</div>; }
afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });

describe('ReconcileReminder banner', () => {
  const rec = (coveredTo: string) => ({ id: 'r1', type: 'reconcile_hosxp', name: 'X', medId: 'm1', qty: -1, unit: 'เม็ด', by: 'u', ts: at('2026-11-16T09:00:00'), coveredFrom: coveredTo, coveredTo });
  async function boot() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-19T10:00:00'));
    renderWithApp(<><ReconcileReminder /><GoProbe /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('meds', []); // the fallback read waits for dbReady
  }
  it('shows the red banner from the live txs window and jumps to นำเข้า HOSxP', async () => {
    await boot();
    fireCollection('txs', [rec('2026-11-16'), { ...rec('2026-11-16'), id: 'r2' }]);
    const b = await screen.findByTestId('reconcile-reminder');
    expect(b).toHaveAttribute('data-level', 'overdue');
    expect(b).toHaveTextContent('2 วันทำการ');
    const user = userEvent.setup({ advanceTimers: () => {} });
    await user.click(screen.getByRole('button', { name: /ตัดยอดเลย/ }));
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('reconcile'));
  });
  it('stays quiet when yesterday is covered', async () => {
    await boot();
    fireCollection('txs', [rec('2026-11-18')]);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('reconcile-reminder')).not.toBeInTheDocument();
  });
  it('falls back to ONE server read when the last reconcile has scrolled out of the 300-row window', async () => {
    await boot();
    seedCollection('txs', [{ id: 'old', type: 'reconcile_hosxp', coveredTo: '2026-11-16', ts: at('2026-11-16T09:00:00'), reason: 'ตัดยอด' }]);
    fireCollection('txs', [{ id: 't1', type: 'transfer_to_floor', name: 'Y', medId: 'm1', qty: 5, unit: 'เม็ด', by: 'u', ts: at('2026-11-19T09:00:00') }]);
    const b = await screen.findByTestId('reconcile-reminder');
    expect(b).toHaveAttribute('data-level', 'overdue');
  });
  it('does not claim a delay when the latest row is a reversal (uncertain)', async () => {
    await boot();
    seedCollection('txs', [{ id: 'rev', type: 'reconcile_hosxp', coveredTo: '2026-11-16', ts: at('2026-11-17T09:00:00'), reason: 'ย้อนการตัดยอด HOSxP' }]);
    fireCollection('txs', [{ id: 't1', type: 'transfer_to_floor', name: 'Y', medId: 'm1', qty: 5, unit: 'เม็ด', by: 'u', ts: at('2026-11-19T09:00:00') }]);
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByTestId('reconcile-reminder')).not.toBeInTheDocument();
  });
});
