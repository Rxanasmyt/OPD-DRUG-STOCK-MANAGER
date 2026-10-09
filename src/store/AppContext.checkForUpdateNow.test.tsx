// Regression test for a real request: "อยากให้มีปุ่มที่ใช้สำหรับการตรวจหาว่ามีเวอร์ชั่นล่าสุดหรือยัง
// ดีกว่ามานั่งรอ เนื่องจากบางที่เมื่อมีการอัพเดตเวอร์ชั่นใหม่แล้วก็อยากใช้งานทันทีเลยครับ" — covers
// checkForUpdateNow()'s (AppContext.tsx) two reachable outcomes once a service worker IS
// registered: nothing new (a toast says so) and tapping again while a version is already found
// short-circuits instead of re-checking needlessly. virtual:pwa-register is mocked here since it
// never resolves in this jsdom test environment otherwise (same as plain `vite dev` — see
// AppContext.tsx's own comment on that dynamic import) — the "registration never even happened"
// branch is covered separately in AppContext.checkForUpdateNow.noRegistration.test.tsx, which
// deliberately does NOT mock this module so it exercises the real unresolved-import behavior.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, hasListener } from '../test-utils/firebaseTestDouble';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

let fakeUpdate = vi.fn(async () => undefined);
let onNeedRefresh: (() => void) | undefined;
vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, reg: unknown) => void }) => {
    onNeedRefresh = opts.onNeedRefresh;
    opts.onRegisteredSW?.('/sw.js', { update: fakeUpdate });
    return vi.fn();
  },
}));

function CheckUpdateHarness() {
  const { checkForUpdateNow } = useApp();
  return <button onClick={() => void checkForUpdateNow()}>check-update</button>;
}

async function setup() {
  renderWithApp(<><CheckUpdateHarness /><Toast /></>);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meta/settings')).toBe(true));
  vi.useFakeTimers();
  // Flushes the mount-time registerSW() call (and its own automatic registration.update() —
  // see onRegisteredSW in AppContext.tsx) under fake time, same "settle first" ordering as
  // AppContext.idleLogout.test.tsx's own setup — otherwise that pending effect would only
  // recreate itself using the FAKE clock after whichever advanceTimersByTimeAsync call comes
  // first, silently eating it.
  await act(async () => { await Promise.resolve(); });
}

describe('checkForUpdateNow — manual update-check button regression', () => {
  it('toasts "ใช้งานเวอร์ชันล่าสุดอยู่แล้ว" when the re-check finds nothing new', async () => {
    fakeUpdate = vi.fn(async () => undefined);
    await setup();
    // fireEvent, not userEvent — userEvent's own internal pointer-sequencing timers hang
    // forever once vi.useFakeTimers() is active without more setup than this needs.
    await act(async () => { fireEvent.click(screen.getByText('check-update')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText('ใช้งานเวอร์ชันล่าสุดอยู่แล้ว')).toBeTruthy();
  });

  it('tapping again while a version is already waiting short-circuits instead of re-checking', async () => {
    let updateCalls = 0;
    // The 1st call is the automatic mount-time check (onRegisteredSW); the 2nd is this test's
    // own explicit tap — modeling "the manual re-check is the one that actually finds it".
    fakeUpdate = vi.fn(async () => { updateCalls++; if (updateCalls === 2) onNeedRefresh?.(); });
    await setup();
    await act(async () => { fireEvent.click(screen.getByText('check-update')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.queryByText('ใช้งานเวอร์ชันล่าสุดอยู่แล้ว')).toBeNull();

    const callsBeforeSecondTap = updateCalls;
    await act(async () => { fireEvent.click(screen.getByText('check-update')); });
    expect(updateCalls).toBe(callsBeforeSecondTap); // no new update() call fired — short-circuited
    expect(screen.getByText('พบเวอร์ชันใหม่อยู่แล้ว — แตะ "อัปเดตเลย" ที่แบนเนอร์ด้านล่างได้เลย')).toBeTruthy();
  });
});
