// Sibling of AppContext.checkForUpdateNow.test.tsx, split into its own file specifically to
// NOT mock virtual:pwa-register — that dynamic import rejects in this jsdom test environment
// exactly like it would in a plain `vite dev` run (see AppContext.tsx's own comment on it),
// so swRegistrationRef.current simply never gets set. Every other existing test in this codebase
// already runs under this same real behavior without noticing; this is the one test that asserts
// on it directly for checkForUpdateNow() (the real request: "อยากให้มีปุ่มที่ใช้สำหรับการตรวจหาว่า
// มีเวอร์ชั่นล่าสุดหรือยัง").
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, hasListener } from '../test-utils/firebaseTestDouble';

function CheckUpdateHarness() {
  const { checkForUpdateNow } = useApp();
  return <button onClick={() => void checkForUpdateNow()}>check-update</button>;
}

describe('checkForUpdateNow — no service worker registered yet', () => {
  it('tells the person nothing is ready to check instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    renderWithApp(<><CheckUpdateHarness /><Toast /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meta/settings')).toBe(true));
    await user.click(screen.getByText('check-update'));
    await screen.findByText('ยังไม่พร้อมตรวจสอบเวอร์ชัน — ลองใหม่อีกครั้งในอีกสักครู่');
  });
});
