// Regression test for a real request: "ตอนนี้หน้าจัดการรายการยา ประเภทยามีเพียงยากิน ยาฉีด และ
// อื่นๆ แต่ยังไม่มียาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — the add/edit form's "ประเภทการให้ยา"
// chips must offer every route in data/routes.ts (ROUTES), not just the original 3. Separate
// file from MedsScreen.incomplete.test.tsx (which already covers the OTHER route-chip surface —
// the "ข้อมูลยังไม่ครบ" quick-fix row) so each surface's own regression stays independently clear.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MedsScreen from './MedsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';
import { ROUTES } from '../data/routes';

describe('MedsScreen — add/edit form route chips regression', () => {
  it('offers every route in ROUTES as a chip in the add-med form, not just ยากิน/ยาฉีด/อื่นๆ', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    await user.click(screen.getByText('+ เพิ่มยาใหม่'));
    for (const r of ROUTES) {
      expect(screen.getByRole('button', { name: r.label })).toBeInTheDocument();
    }
  });

  it('selects a newly-added route (e.g. ยาหยอดตา) on tap, same one-tap toggle as the original chips', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    await user.click(screen.getByText('+ เพิ่มยาใหม่'));
    const eyeChip = screen.getByRole('button', { name: '👁️ ยาหยอดตา' });
    expect(eyeChip).toHaveStyle({ background: 'var(--bg-card)' }); // not yet selected
    await user.click(eyeChip);
    expect(eyeChip).toHaveStyle({ background: 'var(--green)' }); // selected after one tap
  });
});
