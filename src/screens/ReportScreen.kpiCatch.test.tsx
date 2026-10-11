// Regression test for an audit finding: loadKpi() (the "📅 ตัวชี้วัดย้อนหลัง" tab's fetch) had
// no .catch — the sibling "🧠 วิเคราะห์อัตโนมัติ" tab's own fetch was already fixed for this
// exact bug class (see ReportScreen.tsx's "Bug fix (resilience audit)" comment just above
// loadKpi), but the fix was never propagated here: a fetch failure (offline, timeout) left the
// tab silently empty forever with no toast and no retry short of a full page reload.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDocs } from 'firebase/firestore';
import ReportScreen from './ReportScreen';
import Toast from '../components/Toast';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

describe('ReportScreen — kpi tab fetch failure regression', () => {
  it('shows a toast instead of leaving the tab silently empty forever when the fetch rejects', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReportScreen /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    vi.mocked(getDocs).mockRejectedValueOnce(new Error('เชื่อมต่อไม่สำเร็จ'));
    await user.click(await screen.findByRole('button', { name: '📅 ตัวชี้วัดย้อนหลัง' }));

    await screen.findByText('เชื่อมต่อไม่สำเร็จ');
  });
});
