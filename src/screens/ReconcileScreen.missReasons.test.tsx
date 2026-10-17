// Regression test for a real request: "ต้องมีรายละเอียดบอกให้ชัดเจนเลยครับว่ายาในแอพตัวใดไม่ได้ถูก
// ตัดจ่าย ต้องมีเหตุผลกำกับ เช่นจำนวนยาที่จ่าย =0 จึงไม่ได้ถูกตัดจำนวน หรือไม่พบชื่อยาในใบ Hosxp หรือ
// สาเหตุอื่นๆ" — ReconcileScreen now shows, right after processing a file and before committing
// it, every regularly-dispensed med this file does NOT deduct, each with one of a few clear,
// specific reasons. See hosxpMissReasons' own doc comment (selectors.ts) for the full design.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 300, usedPrev30: 300, volatility: 0,
};
// Never appears in any pasted file below — regularly dispensed, so it should surface as
// "not_in_file", never silently dropped.
const MED_MISSING = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 250mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  used30: 200, usedPrev30: 200, volatility: 0,
};
// Genuinely rare (used30 === 0) — must never show up in the panel even though it's also absent
// from the file, same "plenty of genuinely-rare drugs" reasoning every other miss-detector here
// already uses.
const MED_RARE = {
  id: 'm3', code: 'MED-0003', name: 'Rare Drug', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 50, parFloor: 10, floor: 5, bin: 'A3',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const MED_OPD = {
  id: 'm4', code: 'MED-0004', name: 'Insulin NPH', unit: 'ขวด', dosageForm: 'ขวด',
  price: 1, had: false, active: true, parSub: 50, parFloor: 10, floor: 5, bin: 'A4',
  used30: 50, usedPrev30: 50, volatility: 0, ward: 'opd' as const,
};
const MED_IPD = {
  id: 'm5', code: 'MED-0005', name: 'Insulin NPH', unit: 'ขวด', dosageForm: 'ขวด',
  price: 1, had: false, active: true, parSub: 50, parFloor: 10, floor: 5, bin: 'A5',
  used30: 50, usedPrev30: 50, volatility: 0, ward: 'ipd' as const,
};

function Harness({ pastedText }: { pastedText: string }) {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText(pastedText); }, [state.hosxpText, setHosxpText, pastedText]);
  return (
    <>
      <button onClick={() => void processHosxp()}>process</button>
      <ReconcileScreen />
    </>
  );
}

async function setup(pastedText: string, meds: Record<string, unknown>[]) {
  const user = userEvent.setup();
  renderWithApp(<Harness pastedText={pastedText} />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', meds);
  await user.click(screen.getByRole('button', { name: 'process' }));
  return user;
}

describe('ReconcileScreen — miss-reasons panel regression', () => {
  it('explains a med matched with qty=0 as "ปกติ" (zero_qty), not an unexplained gap', async () => {
    await setup('Paracetamol 500mg,0', [MED_A]);

    await screen.findByText('ยาที่ปกติจ่ายทุกวันแต่ไม่ถูกตัดยอดจากไฟล์นี้ (1 รายการ)');
    expect(screen.getByText('ปกติ')).toBeInTheDocument();
    expect(screen.getByText(/จำนวนจ่าย = 0 จึงไม่ตัดยอด — ไม่ใช่ปัญหา/)).toBeInTheDocument();
  });

  it('flags a regularly-dispensed med with nothing in the file as "ไม่พบในไฟล์", and skips a genuinely-rare one', async () => {
    await setup('SomeOtherDrug,5', [MED_A, MED_MISSING, MED_RARE]);

    // MED_A also missing here (not in this file either), plus MED_MISSING — 2 total, never MED_RARE.
    await screen.findByText(/ยาที่ปกติจ่ายทุกวันแต่ไม่ถูกตัดยอดจากไฟล์นี้ \(2 รายการ\)/);
    expect(screen.getAllByText('ไม่พบในไฟล์')).toHaveLength(2);
    expect(screen.queryByText('Rare Drug')).not.toBeInTheDocument();
  });

  it('flags the OPD/IPD same-name collision with its specific explanation, for both records', async () => {
    await setup('Insulin NPH,8', [MED_OPD, MED_IPD]);

    const heading = await screen.findByText('ยาที่ปกติจ่ายทุกวันแต่ไม่ถูกตัดยอดจากไฟล์นี้ (2 รายการ)');
    // Scoped to the miss-reasons panel itself — the per-row match-preview table above it ALSO
    // shows its own "OPD/IPD" explanation (MatchBadge) for the same ambiguous file row, which
    // would otherwise double-count against a page-wide query.
    const panel = heading.closest('.card') as HTMLElement;
    expect(within(panel).getAllByText('ต้องตรวจสอบ')).toHaveLength(2);
    expect(within(panel).getAllByText(/มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน/)).toHaveLength(2);
  });

  it('shows nothing at all when every regularly-dispensed med was deducted normally', async () => {
    await setup('Paracetamol 500mg,10', [MED_A]);

    await screen.findByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ });
    expect(screen.queryByText(/ยาที่ปกติจ่ายทุกวันแต่ไม่ถูกตัดยอด/)).not.toBeInTheDocument();
  });
});
