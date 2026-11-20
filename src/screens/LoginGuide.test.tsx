import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import LoginGuide, { DAILY_STEPS, PERIODIC_STEP } from './LoginGuide';

describe('LoginGuide — daily flow shown before every sign-in', () => {
  it('lists the daily steps in the real order (ตัดยอด → เติมหน้างาน → คืนยาเวรบ่าย) with the real tab names', () => {
    render(<LoginGuide />);
    const items = within(screen.getByTestId('login-guide')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('ตัดยอดหน้างานด้วยไฟล์ HOSxP');
    expect(items[0]).toHaveTextContent('นำเข้า HOSxP');
    expect(items[1]).toHaveTextContent('เติมหน้างาน');
    expect(items[2]).toHaveTextContent('เวรบ่าย');
    expect(items[2]).toHaveTextContent('ปรับยอด / คืนยา');
  });
  it('shows the fortnightly warehouse requisition (weeks 1 and 3) separately from the daily steps', () => {
    render(<LoginGuide />);
    const p = screen.getByTestId('login-guide-periodic');
    expect(p).toHaveTextContent('สัปดาห์ที่ 1 และ 3 ของเดือน');
    expect(p).toHaveTextContent('"รับเข้า"');
  });
  it('every "tap here" label names a tab that really exists in the bottom nav', () => {
    const navTabs = ['หน้าหลัก', 'เติมหน้างาน', 'นำเข้า HOSxP', 'รับเข้า', 'เพิ่มเติม'];
    for (const s of [...DAILY_STEPS, PERIODIC_STEP]) expect(navTabs.some((t) => s.where.includes('"' + t + '"'))).toBe(true);
  });
});
