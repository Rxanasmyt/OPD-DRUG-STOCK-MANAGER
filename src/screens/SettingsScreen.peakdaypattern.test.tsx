// Regression test for a real request: "ยาบางตัว min max par ไม่เหมาะสมกับยาตัวนั่นเนื่องจากบางที่
// จำนวนยาในการใช้ 1 ครั้ง เยอะกว่าค่า min max ปัจจุบันอย่างมาก ยกตัวอย่างนะครับ เช่นยา phenytoin
// 100 mg...สั่งยาจำนวน 3 เดือนใน 1 เคส ใช้ยาจำนวน 270 เม็ด...ดังนั้นยาก็ต้องเบิกฉุกเฉินหน้างานจริง" —
// SettingsScreen's "🚨 ยาที่มีวันจ่ายยาสูงสุดในวันเดียวสูงผิดปกติ" insight panel, sibling of the
// existing weekday-pattern panel but for Med.peakDayQty (see its own doc comment in types.ts and
// suggestPar()'s clamp in selectors.ts — the actual par-sizing fix this panel surfaces).
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateDoc } from 'firebase/firestore';
import SettingsScreen from './SettingsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const BURST_MED = {
  id: 'm1', code: 'MED-0001', name: 'Phenytoin 100mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 50, parFloor: 20, floor: 10, bin: 'A1',
  noSubstock: false, used30: 10, usedPrev30: 10, volatility: 1,
  peakDayQty: 270, peakDayDate: '2025-09-29',
};
const PLAIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  noSubstock: false, used30: 300, usedPrev30: 300, volatility: 1,
};

describe('SettingsScreen — peak-single-day insight regression', () => {
  it('shows the real worst day and flags it in red when it already exceeds the med\'s current Max', async () => {
    renderWithApp(<SettingsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BURST_MED, PLAIN_MED]);
    fireCollection('lots', []);

    const heading = await screen.findByText(/ยาที่มีวันจ่ายยาสูงสุดในวันเดียวสูงผิดปกติ \(1 รายการ, 1 รายการเกิน Max ปัจจุบัน\)/);
    // Scoped to this specific panel — the med's name/par numbers can legitimately also show up
    // elsewhere on this screen (e.g. a par anomaly card), which isn't what this test is about.
    const panel = heading.closest('.card') as HTMLElement;
    expect(within(panel).getByText(BURST_MED.name)).toBeInTheDocument();
    expect(within(panel).getByText('270 เม็ด')).toBeInTheDocument();
    expect(within(panel).getByText(/เกิน Max ปัจจุบัน \(20 เม็ด\)/)).toBeInTheDocument();
    // The plain med (no peak recorded) never shows up in this specific panel.
    expect(within(panel).queryByText(PLAIN_MED.name)).not.toBeInTheDocument();
  });

  it('clears a wrongly-detected peak immediately via the "ล้างค่านี้" button, without waiting for new history to age it out', async () => {
    const user = userEvent.setup();
    renderWithApp(<SettingsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BURST_MED]);
    fireCollection('lots', []);

    await screen.findByText(/ยาที่มีวันจ่ายยาสูงสุดในวันเดียวสูงผิดปกติ/);
    await user.click(screen.getByRole('button', { name: '✕ ล้างค่านี้' }));

    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(0));
    const [, data] = vi.mocked(updateDoc).mock.calls[vi.mocked(updateDoc).mock.calls.length - 1];
    expect((data as unknown as Record<string, unknown>).peakDayQty).toBeUndefined();
  });

  it('hides the panel entirely when no med has a recorded peak yet', async () => {
    renderWithApp(<SettingsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PLAIN_MED]);
    fireCollection('lots', []);

    await screen.findByRole('button', { name: /ใช้ค่าแนะนำทั้งหมด/ });
    expect(screen.queryByText(/ยาที่มีวันจ่ายยาสูงสุดในวันเดียวสูงผิดปกติ/)).not.toBeInTheDocument();
  });

  it('shows amber (not red) when every recorded peak is already within the med\'s current Max', async () => {
    renderWithApp(<SettingsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // Same peak-detection signal, but comfortably under the med's own Max — worth knowing about,
    // not an active emergency-restock risk right now.
    fireCollection('meds', [{ ...BURST_MED, parFloor: 400 }]);
    fireCollection('lots', []);

    await screen.findByText(/ยาที่มีวันจ่ายยาสูงสุดในวันเดียวสูงผิดปกติ \(1 รายการ\)/);
    expect(screen.queryByText(/เกิน Max ปัจจุบัน/)).not.toBeInTheDocument();
  });
});
