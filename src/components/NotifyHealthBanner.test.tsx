// Admin-only banner when a scheduled LINE notifier stopped running or its last run failed (meta/notifyStatus).
import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import NotifyHealthBanner, { notifyProblems } from './NotifyHealthBanner';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, hasListener, seedDoc } from '../test-utils/firebaseTestDouble';

afterEach(() => sessionStorage.clear());
const D = 24 * 3600000;
const NOW = Date.parse('2026-11-25T03:00:00Z');

describe('notifyProblems (pure)', () => {
  it('is quiet when everything ran recently, even if a run had nothing to send', () => {
    expect(notifyProblems({ stock: { ranAt: NOW - D, result: 'nothing' }, hosxp: { ranAt: NOW - 2 * D, result: 'sent' }, monthly: { ranAt: NOW - 20 * D, result: 'sent' } }, NOW)).toEqual([]);
  });
  it('does not false-alarm over a long weekend: 3 days since the last weekday run is fine, 5 is not', () => {
    expect(notifyProblems({ stock: { ranAt: NOW - 3 * D, result: 'nothing' } }, NOW)).toEqual([]);
    expect(notifyProblems({ stock: { ranAt: NOW - 5 * D, result: 'sent' } }, NOW)[0]).toMatchObject({ label: 'สรุปสต็อกประจำวัน', text: 'ไม่ได้ทำงานมา 5 วัน' });
  });
  it('a failed last run is reported with its error, even when it ran an hour ago', () => {
    const p = notifyProblems({ hosxp: { ranAt: NOW - 3600000, result: 'failed', error: 'MOPH Notify failed: 401' } }, NOW);
    expect(p[0]!.text).toContain('ส่งไม่สำเร็จ');
    expect(p[0]!.text).toContain('401');
  });
  it('the monthly job gets 40 days; nothing known → nothing said', () => {
    expect(notifyProblems({ monthly: { ranAt: NOW - 35 * D, result: 'sent' } }, NOW)).toEqual([]);
    expect(notifyProblems({ monthly: { ranAt: NOW - 45 * D, result: 'sent' } }, NOW)).toHaveLength(1);
    expect(notifyProblems(null, NOW)).toEqual([]);
  });
});

async function boot(role: 'admin' | 'pharm', status: unknown) {
  seedDoc('meta/notifyStatus', status as Record<string, unknown> | null);
  renderWithApp(<NotifyHealthBanner />);
  await signInAs('u1', { role, name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  await new Promise((r) => setTimeout(r, 50));
}

describe('NotifyHealthBanner', () => {
  it('warns an admin on the home screen when a job last failed', async () => {
    await boot('admin', { stock: { ranAt: Date.now() - 3600000, result: 'failed', error: 'boom' } });
    expect(await screen.findByTestId('notify-health-banner')).toHaveTextContent('สรุปสต็อกประจำวัน');
  });
  it('stays quiet for healthy runs, for non-admins, and before any stamp exists', async () => {
    await boot('admin', { stock: { ranAt: Date.now() - 3600000, result: 'nothing' } });
    expect(screen.queryByTestId('notify-health-banner')).not.toBeInTheDocument();
  });
  it('not shown to a pharmacist', async () => {
    await boot('pharm', { stock: { ranAt: Date.now() - 3600000, result: 'failed' } });
    expect(screen.queryByTestId('notify-health-banner')).not.toBeInTheDocument();
  });
  it('no stamp yet → silent', async () => {
    await boot('admin', null);
    expect(screen.queryByTestId('notify-health-banner')).not.toBeInTheDocument();
  });
});
