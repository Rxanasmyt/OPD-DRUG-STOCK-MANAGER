// Regression test for the audit finding "unbounded export query" — exportAudit()/
// exportAllReports()/exportReportCsv()'s discrepancy-log tab each pull the ENTIRE txs
// collection (two of them also the full auditLog) with no limit() at all, and with no
// visibility to the person clicking "export" about how big that pull actually is or any way
// to back out once it starts. Fixed with confirmLargeExport() (AppContext.tsx) — a pre-flight
// getCountFromServer() check that warns, with a cancel option, once the combined count passes
// LARGE_EXPORT_WARN_AT, but still exports the FULL, untruncated history once confirmed (or
// whenever the count is below the threshold) — this is deliberately NOT a silent cap on what
// gets exported. exportAudit() is the simplest of the three real call sites to drive directly
// through useApp(), and confirmLargeExport() itself is shared code reused by all three, so this
// one function's coverage stands in for exportAllReports()/exportReportCsv() as well.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>();
  return { ...actual, downloadCsv: vi.fn(async () => 'saved' as const) };
});
import { downloadCsv } from '../utils/csv';

function ExportAuditHarness() {
  const { exportAudit } = useApp();
  return <button onClick={exportAudit}>export-audit</button>;
}

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<><ExportAuditHarness /><Toast /><ConfirmDialog /></>);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  return user;
}

describe('exportAudit — unbounded export warning regression', () => {
  // downloadCsv is a module-level vi.fn() mock, not reset by the global firebaseTestDouble
  // afterEach (that only resets the Firestore test double itself) — without clearing it here,
  // the second/third test in this file would still see the first test's call recorded.
  beforeEach(() => { vi.mocked(downloadCsv).mockClear(); });

  it('exports directly with no warning dialog when the history is small', async () => {
    seedCollection('auditLog', []);
    seedCollection('txs', [{ type: 'adjust', by: 'x', ts: Date.now(), note: 'n' }]);
    const user = await setup();

    await user.click(screen.getByText('export-audit'));
    await waitFor(() => expect(vi.mocked(downloadCsv).mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByText(/ต้องการดำเนินการต่อหรือไม่/)).not.toBeInTheDocument();
  });

  it('warns before a large export and lets the person cancel without exporting anything', async () => {
    seedCollection('auditLog', Array.from({ length: 3000 }, (_, i) => ({ type: 'login', by: 'x', ts: i, note: '' })));
    seedCollection('txs', Array.from({ length: 2500 }, (_, i) => ({ type: 'adjust', by: 'x', ts: i, note: '' })));
    const user = await setup();

    await user.click(screen.getByText('export-audit'));
    await screen.findByText(/ต้องการดำเนินการต่อหรือไม่/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(downloadCsv).not.toHaveBeenCalled();
  });

  it('exports the full untruncated history once the person confirms the warning', async () => {
    seedCollection('auditLog', Array.from({ length: 3000 }, (_, i) => ({ type: 'login', by: 'x', ts: i, note: '' })));
    seedCollection('txs', Array.from({ length: 2500 }, (_, i) => ({ type: 'adjust', by: 'x', ts: i, name: 'ยา', note: '' })));
    const user = await setup();

    await user.click(screen.getByText('export-audit'));
    await screen.findByText(/ต้องการดำเนินการต่อหรือไม่/);
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(vi.mocked(downloadCsv).mock.calls.length).toBeGreaterThan(0));
    const [rows] = vi.mocked(downloadCsv).mock.calls[0];
    // 1 header row + 3000 audit rows + 2500 txs rows = the full combined history, never a
    // silently truncated sample.
    expect(rows.length).toBe(1 + 3000 + 2500);
  });
});
