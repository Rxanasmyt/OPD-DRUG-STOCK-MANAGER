// Regression test for a real request: "ทำยังไงให้การเบิกเติมยาเสถียรที่สุด" (part 2 — "ติดตามผล
// หลังปรับ par ว่านิ่งจริงไหม") — applyOnePar/applyAllSuggested used to write only the new par
// numbers, with logAudit's free-text note as the only trace. Neither lets a later report ask
// "did THIS specific change actually calm down?" — this locks in the durable, structured
// parAdjustments record both actions now also write, through the real AppProvider/useApp()
// plumbing (not a hand-mocked context) via renderWithApp + firebaseTestDouble.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDoc } from 'firebase/firestore';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, getLastBatchWrites } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 200, usedPrev30: 100, volatility: 1, // used30>0 and no category set -> categoryOf() falls back to 'other'
};

function ApplyOneParHarness() {
  const { applyOnePar } = useApp();
  return <button onClick={() => applyOnePar(MED.id, 'floor')}>apply-one</button>;
}

function ApplyAllSuggestedHarness() {
  const { applyAllSuggested } = useApp();
  return <button onClick={applyAllSuggested}>apply-all</button>;
}

describe('applyOnePar — durable parAdjustments regression', () => {
  it('writes a parAdjustments record with the before/after par and the usage data that justified it', async () => {
    const user = userEvent.setup();
    renderWithApp(<ApplyOneParHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(await screen.findByText('apply-one'));

    await waitFor(() => expect(vi.mocked(addDoc).mock.calls.some((c) => (c[0] as { path?: string }).path === 'parAdjustments')).toBe(true));
    const call = vi.mocked(addDoc).mock.calls.find((c) => (c[0] as { path?: string }).path === 'parAdjustments')!;
    expect(call[1]).toMatchObject({
      medId: 'm1', medName: 'Paracetamol 500mg', category: 'other',
      beforeFloor: 100, beforeSub: 500,
      used30AtAdjust: 200, usedPrev30AtAdjust: 100,
      adjustedBy: 'ทดสอบ Admin',
    });
  });
});

describe('applyAllSuggested — durable parAdjustments regression', () => {
  it('writes one parAdjustments record per med it actually changes, in the same batch as the par update', async () => {
    const user = userEvent.setup();
    renderWithApp(<ApplyAllSuggestedHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(await screen.findByText('apply-all'));

    await waitFor(() => expect(getLastBatchWrites().some((w) => w.path.startsWith('parAdjustments/'))).toBe(true));
    const writes = getLastBatchWrites();
    const medUpdate = writes.find((w) => w.kind === 'update' && w.path === 'meds/m1');
    expect(medUpdate?.data).toMatchObject({ parFloor: expect.any(Number), parSub: expect.any(Number) });

    const adjustmentWrite = writes.find((w) => w.kind === 'set' && w.path.startsWith('parAdjustments/'));
    expect(adjustmentWrite?.data).toMatchObject({
      medId: 'm1', medName: 'Paracetamol 500mg', category: 'other',
      beforeFloor: 100, beforeSub: 500,
      used30AtAdjust: 200, usedPrev30AtAdjust: 100,
    });
  });
});
