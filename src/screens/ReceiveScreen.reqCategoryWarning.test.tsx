// Regression test for a real stock-out risk found auditing printing flows for "หน้างานจริง" use:
// a med with no `reqCategory` set (an optional field on the add/edit form, never enforced)
// silently falls out of ALL 4 category-specific warehouse-request sheets (printWarehouseRequestByCategory
// matches on reqCategoryOf(m) === categoryFilter — undefined never equals a real category id). It
// still appears on the legacy combined sheet, but that's not what staff actually carry to the
// warehouse day to day — so this med was never requested via the normal path, with zero warning.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReceiveScreen from './ReceiveScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED_NO_CATEGORY = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
  // reqCategory deliberately omitted — the real-world case (never set on the add-med form).
};

const MED_WITH_CATEGORY = {
  ...MED_NO_CATEGORY, id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', reqCategory: 'tablet',
};

describe('ReceiveScreen — missing reqCategory warning regression', () => {
  it('warns when an active med has no requisition category, so it is never silently missing from all 4 category sheets', async () => {
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_NO_CATEGORY]);

    await screen.findByText(/มียา 1 รายการที่ยังไม่ได้ตั้งหมวดใบเบิก/);
  });

  it('shows no warning once every active med has a requisition category set', async () => {
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_WITH_CATEGORY]);

    await waitFor(() => expect(screen.getByText('🖨 พิมพ์ใบขอเบิกจากคลังใหญ่ — รอบ 2 สัปดาห์ (แยกตามหมวดเดิม)')).toBeInTheDocument());
    expect(screen.queryByText(/ยังไม่ได้ตั้งหมวดใบเบิก/)).not.toBeInTheDocument();
  });
});
