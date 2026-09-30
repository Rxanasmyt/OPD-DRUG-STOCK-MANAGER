// Regression test for a real misleading-number bug found by audit: the "ลบยาที่ปิดใช้งาน..."
// bulk-delete button used to show meds.length — every inactive med in the current filter,
// regardless of remaining stock — but deleteAllInactiveMeds() (AppContext.tsx) only ever
// actually deletes the subset with floor===0 AND subQty===0; a med with leftover stock is
// silently skipped. The button itself (what an admin reads before ever reaching the confirm
// dialog) overstated how many meds would actually be purged. See MedsScreen.tsx's own
// "Bug fix (misleading count)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MedsScreen from './MedsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// Inactive, floor 0, no lots → removable (floor===0 && subQty===0).
const REMOVABLE_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: false, parSub: 500, parFloor: 100, floor: 0, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// Inactive but still has real floor stock left → NOT removable, deleteAllInactiveMeds skips it.
const BLOCKED_MED = {
  id: 'm2', code: 'MED-0002', name: 'Warfarin 2mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: false, parSub: 500, parFloor: 100, floor: 5, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('MedsScreen — bulk-delete button count regression', () => {
  it('shows only the REMOVABLE count (floor===0 && subQty===0), not every inactive med in the filter', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [REMOVABLE_MED, BLOCKED_MED]);
    fireCollection('lots', []);

    await user.click(screen.getByRole('button', { name: 'ปิดใช้งาน' }));

    // Without the fix, this would read "...(2 รายการ)" — both inactive meds, even though only
    // REMOVABLE_MED (floor 0, no substock) would actually be deleted.
    await screen.findByText(/ลบยาที่ปิดใช้งานและยอดเป็น 0 ทั้งหมดออกจากระบบถาวร \(1 รายการ\)/);
    expect(screen.queryByText(/ลบยาที่ปิดใช้งานและยอดเป็น 0 ทั้งหมดออกจากระบบถาวร \(2 รายการ\)/)).not.toBeInTheDocument();
  });
});
