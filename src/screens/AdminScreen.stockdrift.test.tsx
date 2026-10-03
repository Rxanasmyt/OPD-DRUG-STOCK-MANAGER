// Regression test for a real request: "ทำอย่างไรให้แอพมีความเสถียรที่สามารถใช้งานจริงในรพ.ได้
// เหมือนระบบ hosxp" — scripts/check-stock-drift.mjs (the new automated daily drift check) writes
// an auditLog entry of type 'stock_drift_detected' when live stock disagrees with the tx log.
// This locks in that AdminScreen's audit log actually shows the Thai label for it (TYPE_LABEL,
// AdminScreen.tsx) instead of falling back to the raw English type string — the same class of
// gap a future added AuditType with no matching label entry would hit silently.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminScreen from './AdminScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

describe('AdminScreen — stock_drift_detected audit label regression', () => {
  it('shows the Thai label for a stock_drift_detected entry, not the raw type string', async () => {
    const user = userEvent.setup();
    renderWithApp(<AdminScreen />);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('auditLog')).toBe(true));
    fireCollection('auditLog', [
      { id: 'a1', type: 'stock_drift_detected', by: 'ระบบ (ตรวจสอบอัตโนมัติ)', ts: Date.now(), note: 'ตรวจพบความเพี้ยนของยอดคงคลัง 1 รายการ' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Audit log' }));

    await screen.findByText('ตรวจพบความเพี้ยนของยอดคงคลัง (ตรวจสอบอัตโนมัติ)');
    // Without a matching TYPE_LABEL entry, typeLabelOf() falls back to the raw type string —
    // confirm that never shows instead.
    expect(screen.queryByText('stock_drift_detected')).not.toBeInTheDocument();
  });
});
