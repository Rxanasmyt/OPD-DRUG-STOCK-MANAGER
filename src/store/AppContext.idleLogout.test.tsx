// Regression test for a real request: "ตอนนี้ถ้า login นานทิ้งไว้ จะไม่ logout ออกให้อัตโนมัติเลย
// ซึ่งอันตรายสำหรับข้อมูลยา" — nothing in the app ever signed anyone out for being idle before
// this. Covers the actual idle-timeout mechanics in AppContext.tsx (lastActivityRef tracking,
// the 1-minute idleWarnVisible window, logout()/idle_logout audit entry on real timeout, and
// activity/"ยังอยู่" resetting the clock) — not the SettingsScreen UI for idleLogoutMinutes
// itself, which is a plain copy of the already-covered expiryWarnDays save-button shape.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, screen, waitFor, fireEvent } from '@testing-library/react';
import { signOut } from 'firebase/auth';
import IdleLogoutWarning from '../components/IdleLogoutWarning';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireDoc, hasListener } from '../test-utils/firebaseTestDouble';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function setup(idleLogoutMinutes: number) {
  renderWithApp(<IdleLogoutWarning />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meta/settings')).toBe(true));
  fireDoc('meta/settings', { idleLogoutMinutes });
  // Only switch to fake timers once the real sign-in/listener-registration dance above (which
  // itself leans on waitFor's own real-timer polling) is fully settled — see
  // SettingsScreen.usagestaleness.test.tsx for the same setup-then-freeze ordering.
  vi.useFakeTimers();
  // fireDoc() above triggers a patch() outside any act() boundary, so React hasn't actually
  // re-rendered/re-run the idle-check effect for the new idleLogoutMinutes yet (it's still
  // pending) — without this flush, that effect only recreates its setInterval AFTER whatever
  // advanceTimersByTimeAsync call happens to come first, using the real (not fake) clock for
  // everything up to that point, silently eating the first advance.
  await act(async () => { await Promise.resolve(); });
}

describe('AppContext — idle-timeout auto-logout regression', () => {
  it('shows the "ยังอยู่" warning exactly 1 minute before the configured timeout, not before', async () => {
    await setup(5); // clamped floor is 5 — warn at 4:00 idle, logout at 5:00 idle
    expect(screen.queryByText('ยังอยู่ ทำงานต่อ')).toBeNull();

    // Still inside the 4-minute mark — nothing should show yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 30000); });
    expect(screen.queryByText('ยังอยู่ ทำงานต่อ')).toBeNull();

    // Past 4:00 idle (the next 15s poll tick after it) — warning appears.
    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    expect(screen.getByText('ยังอยู่ ทำงานต่อ')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out and logs an idle_logout audit entry once truly past the full timeout', async () => {
    await setup(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 15000); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not keep calling signOut again on later ticks for the same idle period', async () => {
    await setup(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 15000); });
    expect(signOut).toHaveBeenCalledTimes(1);
    // Several more 15s polls tick by with nobody touching anything — still just the one call,
    // not one per tick (see idleFiredRef's own doc comment on why this needs guarding).
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('tapping "ยังอยู่" dismisses the warning and restarts the idle clock from zero', async () => {
    await setup(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 15000); });
    const stillHereBtn = screen.getByText('ยังอยู่ ทำงานต่อ');
    fireEvent.click(stillHereBtn);
    expect(screen.queryByText('ยังอยู่ ทำงานต่อ')).toBeNull();

    // Only 2 more minutes idle since the reset — well short of the 4-minute warn mark again.
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 1000); });
    expect(screen.queryByText('ยังอยู่ ทำงานต่อ')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});
