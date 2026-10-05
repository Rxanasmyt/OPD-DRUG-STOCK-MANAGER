// Regression test for a real request: "นำข้อมูลการจ่ายยาหน้างานจริงในแต่ละวันจันทร์-ศุกร์ มา
// วิเคราะห์การใช้ยาจริง" — SettingsScreen's new "วิเคราะห์รูปแบบการใช้ยารายวัน" button and the
// durable insight panel that lists every med analyzeWeekdayUsage() has found a real pattern for
// (not just a one-time toast). See SettingsScreen.tsx's own "Real-world request" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from './SettingsScreen';
import Toast from '../components/Toast';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedCollection } from '../test-utils/firebaseTestDouble';

const PATTERNED_MED = {
  id: 'm1', code: 'MED-0001', name: 'Metformin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  noSubstock: false, used30: 300, usedPrev30: 300, volatility: 1,
  weekdayPeakFactor: 2.5, weekdayPeakDay: 2, // already analyzed: busiest on Tuesday
};
const PLAIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  noSubstock: false, used30: 300, usedPrev30: 300, volatility: 1,
};

describe('SettingsScreen — weekday-usage-pattern insight regression', () => {
  it('shows a durable insight panel listing every med with a real detected weekday pattern, cross-referenced against the known Tuesday diabetes clinic', async () => {
    renderWithApp(<SettingsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PATTERNED_MED, PLAIN_MED]);
    fireCollection('lots', []);

    await screen.findByText(/ยาที่มีรูปแบบการใช้รายวันชัดเจน \(1 รายการ\)/);
    expect(screen.getByText(PATTERNED_MED.name)).toBeInTheDocument();
    expect(screen.getByText('×2.50')).toBeInTheDocument();
    expect(screen.getByText(/ใช้มากสุดวันอังคาร/)).toBeInTheDocument();
    expect(screen.getByText(/ตรงกับคลินิก: อังคาร: เบาหวาน/)).toBeInTheDocument();
    // The plain med (no pattern detected) never shows up in this specific panel.
    expect(screen.queryByText(PLAIN_MED.name)).not.toBeInTheDocument();
  });

  it('hides the panel entirely when no med has a detected pattern yet', async () => {
    renderWithApp(<SettingsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PLAIN_MED]);
    fireCollection('lots', []);

    await screen.findByRole('button', { name: /ใช้ค่าแนะนำทั้งหมด/ });
    expect(screen.queryByText(/ยาที่มีรูปแบบการใช้รายวันชัดเจน/)).not.toBeInTheDocument();
  });

  it('runs analyzeWeekdayUsage when the button is tapped', async () => {
    const user = userEvent.setup();
    renderWithApp(<><SettingsScreen /><Toast /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PLAIN_MED]);
    fireCollection('lots', []);
    seedCollection('txs', []);

    const button = await screen.findByRole('button', { name: 'วิเคราะห์รูปแบบการใช้ยารายวัน (จ-ศ) ↺' });
    await user.click(button);
    // No reconcile_hosxp history seeded at all -> the "no history yet" toast specifically.
    await screen.findByText(/ยังไม่มียาตัวไหนมีประวัติ HOSxP ต่อเนื่องพอจะวิเคราะห์/);
  });
});
