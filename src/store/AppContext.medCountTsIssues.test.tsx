// Regression test for a real production incident: a floor-count commit (commitCount) kept
// failing with only a generic "บันทึกไม่สำเร็จ" toast for one specific med — traced to
// firestore.rules requiring lastCountTs/lastSubCountTs be `is number` WHENEVER PRESENT (see
// meds.update's isActive() branch in firestore.rules), so a malformed value (a literal `null`
// is the one concrete way this has actually happened — see resetAllQuantities' own
// snapshotBeforeDelete fix in AppContext.tsx) silently rejects EVERY future write to that med,
// not just one touching that field. scanMedCountTsIssues/repairMedCountTsIssues give an admin a
// way to find and fix this without hitting the same error on every drug by hand to find out
// which ones are affected.
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener, getLastBatchWrites } from '../test-utils/firebaseTestDouble';
import Toast from '../components/Toast';
import type { MedCountTsIssue } from '../types';

const MED_BAD_NULL = {
  id: 'm1', code: 'MED-0001', name: 'Anoro ellipta inhaler', unit: 'กล่อง', dosageForm: 'พ่น',
  price: 1000, had: false, active: true, parSub: 0, parFloor: 10, floor: 24, bin: 'Y2',
  noSubstock: true, used30: 1, usedPrev30: 1, volatility: 0, lastCountTs: null,
};
const MED_BAD_SUBSTRING = {
  id: 'm2', code: 'MED-0002', name: 'Insulin NPH', unit: 'ขวด', dosageForm: 'ฉีด',
  price: 100, had: false, active: true, parSub: 30, parFloor: 10, floor: 5, bin: 'B1', binSub: 'S1',
  used30: 1, usedPrev30: 1, volatility: 0, lastSubCountTs: 'invalid-timestamp',
};
const MED_CLEAN = {
  id: 'm3', code: 'MED-0003', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  used30: 1, usedPrev30: 1, volatility: 0, lastCountTs: Date.now(),
};
const MED_NEVER_COUNTED = {
  id: 'm4', code: 'MED-0004', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A3',
  used30: 1, usedPrev30: 1, volatility: 0,
};

function ScanHarness() {
  const { scanMedCountTsIssues, repairMedCountTsIssues } = useApp();
  const [issues, setIssues] = useState<MedCountTsIssue[] | null>(null);
  return (
    <div>
      <button onClick={() => scanMedCountTsIssues().then(setIssues)}>scan</button>
      <button onClick={() => { if (issues) repairMedCountTsIssues(issues); }}>repair</button>
      {issues && <div data-testid="issue-count">{issues.length}</div>}
      {issues?.map((it) => (
        <div key={it.medId} data-testid={'issue-' + it.medId}>
          {it.medName}:{it.badLastCountTs ? 'C' : ''}{it.badLastSubCountTs ? 'S' : ''}
        </div>
      ))}
    </div>
  );
}

describe('scanMedCountTsIssues — malformed lastCountTs/lastSubCountTs detection regression', () => {
  it('flags a med whose lastCountTs is a literal null', async () => {
    const user = userEvent.setup();
    renderWithApp(<ScanHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_BAD_NULL, MED_CLEAN]);
    seedCollection('meds', [MED_BAD_NULL, MED_CLEAN]);

    await user.click(screen.getByRole('button', { name: 'scan' }));
    await waitFor(() => expect(screen.getByTestId('issue-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('issue-' + MED_BAD_NULL.id)).toHaveTextContent('C');
    expect(screen.queryByTestId('issue-' + MED_CLEAN.id)).not.toBeInTheDocument();
  });

  it('flags a med whose lastSubCountTs is present but not a number (any malformed type, not just null)', async () => {
    const user = userEvent.setup();
    renderWithApp(<ScanHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_BAD_SUBSTRING, MED_CLEAN]);
    seedCollection('meds', [MED_BAD_SUBSTRING, MED_CLEAN]);

    await user.click(screen.getByRole('button', { name: 'scan' }));
    await waitFor(() => expect(screen.getByTestId('issue-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('issue-' + MED_BAD_SUBSTRING.id)).toHaveTextContent('S');
  });

  it('never flags a med with a real numeric timestamp or one that was simply never counted', async () => {
    const user = userEvent.setup();
    renderWithApp(<ScanHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_CLEAN, MED_NEVER_COUNTED]);
    seedCollection('meds', [MED_CLEAN, MED_NEVER_COUNTED]);

    await user.click(screen.getByRole('button', { name: 'scan' }));
    await waitFor(() => expect(screen.getByTestId('issue-count')).toHaveTextContent('0'));
  });

  it('repairs exactly the malformed field(s) via deleteField(), leaving the rest of the doc untouched', async () => {
    const user = userEvent.setup();
    renderWithApp(<ScanHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_BAD_NULL, MED_BAD_SUBSTRING]);
    seedCollection('meds', [MED_BAD_NULL, MED_BAD_SUBSTRING]);

    await user.click(screen.getByRole('button', { name: 'scan' }));
    await waitFor(() => expect(screen.getByTestId('issue-count')).toHaveTextContent('2'));
    await user.click(screen.getByRole('button', { name: 'repair' }));

    await waitFor(() => expect(getLastBatchWrites().length).toBe(2));
    const writes = getLastBatchWrites();
    const m1Write = writes.find((w) => w.path === 'meds/m1');
    const m2Write = writes.find((w) => w.path === 'meds/m2');
    expect(m1Write?.kind).toBe('update');
    expect(m1Write?.data && 'lastCountTs' in m1Write.data).toBe(true);
    expect(m1Write?.data && 'lastSubCountTs' in m1Write.data).toBe(false);
    expect(m2Write?.data && 'lastSubCountTs' in m2Write.data).toBe(true);
    expect(m2Write?.data && 'lastCountTs' in m2Write.data).toBe(false);
  });

  it('blocks repair for a non-admin, writing nothing', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ScanHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_BAD_NULL]);
    seedCollection('meds', [MED_BAD_NULL]);

    await user.click(screen.getByRole('button', { name: 'scan' }));
    await waitFor(() => expect(screen.getByTestId('issue-count')).toHaveTextContent('1'));
    await user.click(screen.getByRole('button', { name: 'repair' }));

    await screen.findByText(/เฉพาะ Admin เท่านั้น/);
    expect(getLastBatchWrites().length).toBe(0);
  });
});
