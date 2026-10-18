// Regression test for a real follow-up request: "มีอะไรที่ต้องพัฒนาอีกครับเพื่อแอพแม่นยำเรื่องชื่อยา
// เพื่อไม่ให้หลุดยาในรพ.ที่มีในแอพ" — commitReconcile() (AppContext.tsx) now persists its own
// 'hosxp_miss_reasons' audit entries (see its own doc comment) so the specific reason a
// regularly-dispensed med fell through survives past the moment that file is committed. This
// retrospective "ฝั่งแอพ" panel aggregates those entries by (med name, reason), shown stacked
// right next to the pre-existing "ฝั่งไฟล์" unmatchedFreq panel under one shared heading — per
// the real request: "รวมแผง 'ยาที่หลุดบ่อย' (ฝั่งไฟล์) กับแผงใหม่ (ฝั่งยาในแอพ) ให้ดูคู่กัน".
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 250mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 200, usedPrev30: 200, volatility: 0,
};

// The auditLog listener is screen-scoped (see AppContext.auditLogScoped.test.tsx) — only live
// while state.screen is 'reconcile'/'admin', so this harness has to actually navigate there
// first, same as that test's own NavHarness.
function Harness() {
  const { state, go } = useApp();
  useEffect(() => { go('reconcile'); }, [go]);
  return (
    <>
      {/* Exposes nav state the "แก้ไขชื่อยา..." fix-it link is supposed to set — see
          ReconcileScreen.tsx's own goFixMed(). */}
      <div data-testid="nav-state">{state.screen}:{state.medsFocusId ?? 'none'}</div>
      <ReconcileScreen />
    </>
  );
}

async function setup(meds: Record<string, unknown>[] = []) {
  renderWithApp(<Harness />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', meds);
  await waitFor(() => expect(hasListener('auditLog')).toBe(true));
}

describe('ReconcileScreen — retrospective "ฝั่งแอพ" miss-reasons history panel regression', () => {
  it('aggregates hosxp_miss_reasons audit entries by (med, reason), with the right badge and count', async () => {
    await setup();
    fireCollection('auditLog', [
      { id: 'a1', type: 'hosxp_miss_reasons', by: 'x', ts: Date.now(), note: 'ยาที่ปกติจ่ายแต่ไม่ถูกตัดยอดจากไฟล์นี้ 1 รายการ\n[not_in_file] Amoxicillin 250mg' },
      { id: 'a2', type: 'hosxp_miss_reasons', by: 'x', ts: Date.now() - 1000, note: 'ยาที่ปกติจ่ายแต่ไม่ถูกตัดยอดจากไฟล์นี้ 1 รายการ\n[not_in_file] Amoxicillin 250mg' },
      { id: 'a3', type: 'hosxp_miss_reasons', by: 'x', ts: Date.now() - 2000, note: 'ยาที่ปกติจ่ายแต่ไม่ถูกตัดยอดจากไฟล์นี้ 1 รายการ\n[ambiguous] Insulin NPH' },
    ]);

    await screen.findByText('ยาที่หลุดบ่อย (ย้อนหลัง)');
    expect(screen.getByText('ฝั่งแอพ — ยาในแอพที่ไม่ถูกตัดยอดบ่อย พร้อมเหตุผล')).toBeInTheDocument();
    expect(screen.getByText('Amoxicillin 250mg')).toBeInTheDocument();
    expect(screen.getByText('2 ครั้ง')).toBeInTheDocument();
    expect(screen.getByText('ไม่พบในไฟล์')).toBeInTheDocument();
    expect(screen.getByText('Insulin NPH')).toBeInTheDocument();
    expect(screen.getByText('1 ครั้ง')).toBeInTheDocument();
    expect(screen.getByText('ต้องตรวจสอบ')).toBeInTheDocument();
  });

  it('shows neither retrospective panel when the audit log has no relevant entries', async () => {
    await setup();
    fireCollection('auditLog', [{ id: 'a1', type: 'login', by: 'x', ts: Date.now(), note: '' }]);
    expect(screen.queryByText('ยาที่หลุดบ่อย (ย้อนหลัง)')).not.toBeInTheDocument();
  });

  // Real-world request: "สามารถเชื่อมโยงปัญหานั่นไปแก้ปัญหาจริงได้" — a "ไม่พบในไฟล์" row here
  // resolves the stored med NAME back to the live med and jumps straight to its edit form.
  it('the fix-it link on a "ไม่พบในไฟล์" row resolves the med by name and jumps to its edit form', async () => {
    const user = userEvent.setup();
    await setup([MED_A]);
    fireCollection('auditLog', [
      { id: 'a1', type: 'hosxp_miss_reasons', by: 'x', ts: Date.now(), note: 'ยาที่ปกติจ่ายแต่ไม่ถูกตัดยอดจากไฟล์นี้ 1 รายการ\n[not_in_file] Amoxicillin 250mg' },
    ]);

    await screen.findByText('Amoxicillin 250mg');
    await user.click(screen.getByRole('button', { name: /แก้ไขชื่อยา\/เพิ่มชื่อ HOSxP ที่รู้จัก/ }));
    expect(screen.getByTestId('nav-state')).toHaveTextContent('meds:' + MED_A.id);
  });

  it('shows no fix-it link on an "ต้องตรวจสอบ" (ambiguous) row — not a single-med fix', async () => {
    await setup([MED_A]);
    fireCollection('auditLog', [
      { id: 'a1', type: 'hosxp_miss_reasons', by: 'x', ts: Date.now(), note: 'ยาที่ปกติจ่ายแต่ไม่ถูกตัดยอดจากไฟล์นี้ 1 รายการ\n[ambiguous] Insulin NPH' },
    ]);

    await screen.findByText('Insulin NPH');
    expect(screen.queryByRole('button', { name: /แก้ไขชื่อยา/ })).not.toBeInTheDocument();
  });
});
