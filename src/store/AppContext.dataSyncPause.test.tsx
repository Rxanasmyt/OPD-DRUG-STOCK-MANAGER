// Regression test for a real request: "ลดการอ่านข้อมูลตอนที่ยังไม่ได้ใช้งานแอพ" — every onSnapshot
// listener in the live-data effect (meds/lots/floorLots/txs/pendingReceives/settings/users) used
// to stay fully subscribed for a device's entire idleLogoutMinutes window (30 min default) even
// while nobody was actually looking at it (tab backgrounded, or just left open untouched) —
// billing a Firestore read for every OTHER device's write pushed to it the whole time. Covers the
// actual pause/resume mechanics in AppContext.tsx: the visible-but-idle threshold (folded into
// the existing idle-logout 15s poll), the hidden-tab grace period (its own visibilitychange
// effect), and instant resume on either real activity or the tab becoming visible again. Does NOT
// re-test the pre-sign-in case — the live-data effect's own `authStatus !== 'signedIn'` guard
// already covers that and is exercised throughout every other AppContext test in this file set.
//
// Follow-up (real request): "ช่วยแก้ปัญหาเรื่องการใช้งานหลายๆ เครื่องด้วยครับ ให้ประหยัดการใช้ข้อมูล
// มากที่สุด" — confirmed via real GitHub Actions log forensics that every scheduled background job
// combined costs under 10,000 reads/day, so the dominant remaining cost on a real multi-device day
// is the live-listener fan-out itself. Both thresholds below tightened (IDLE_PAUSE_MS 3min→60s,
// HIDDEN_PAUSE_MS 60s→15s) to cut how long an untouched device keeps counting as "live" between
// real actions, without changing the pause/resume mechanics themselves.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireDoc, hasListener } from '../test-utils/firebaseTestDouble';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility('visible'); // leave jsdom's document in its default state for the next test
});

async function setup() {
  renderWithApp(<div />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
}

describe('AppContext — data-sync pause on a backgrounded/hidden tab', () => {
  // The hidden-tab timer is created lazily inside the visibilitychange handler itself (not at
  // effect-mount time), so switching to fake timers right after setup() — before ever
  // dispatching visibilitychange — is enough for it to land under the fake clock; no extra
  // dependency-change trick is needed here (contrast with the idle-visible tests below).
  it('tears the live listeners down once hidden past the 15s grace period', async () => {
    await setup();
    vi.useFakeTimers();
    act(() => setVisibility('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000 + 1000); });
    expect(hasListener('meds')).toBe(false);
  });

  it('does not pause on a quick hidden-then-visible toggle, well under the grace period', async () => {
    await setup();
    vi.useFakeTimers();
    act(() => setVisibility('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => setVisibility('visible'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000 + 1000); });
    expect(hasListener('meds')).toBe(true);
  });

  it('resumes instantly the moment a hidden tab becomes visible again', async () => {
    await setup();
    vi.useFakeTimers();
    act(() => setVisibility('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000 + 1000); });
    expect(hasListener('meds')).toBe(false);
    act(() => setVisibility('visible'));
    expect(hasListener('meds')).toBe(true);
  });
});

describe('AppContext — data-sync pause while visible but genuinely untouched', () => {
  // The idle-pause check is folded into the SAME 15s setInterval the idle-logout warning already
  // polls on — that interval is created once at mount, before this test ever switches to fake
  // timers, so (same reasoning as AppContext.idleLogout.test.tsx's own setup()) a real interval
  // would otherwise keep ticking on the real clock, unaffected by vi.advanceTimersByTimeAsync.
  // Firing a settings doc change right after switching timers forces that effect's
  // idleLogoutMinutes dependency to change, so React tears it down and re-registers it — THIS
  // TIME under the now-fake setInterval — before any time is advanced. Must be a genuinely
  // DIFFERENT value than the 30-minute default (React's dependency check compares the actual
  // value, not just that patch() was called) — 20 minutes, still comfortably clear of every
  // window these tests advance past (well under 2 minutes), so it never trips the warn/logout
  // path itself.
  async function setupWithFakeIdleInterval() {
    await setup();
    await waitFor(() => expect(hasListener('meta/settings')).toBe(true));
    vi.useFakeTimers();
    fireDoc('meta/settings', { idleLogoutMinutes: 20 });
    await act(async () => { await Promise.resolve(); });
  }

  it('pauses once idle past the 60s threshold, well before the 20-minute logout', async () => {
    await setupWithFakeIdleInterval();
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000 + 15000); });
    expect(hasListener('meds')).toBe(false);
  });

  it('does not pause before the 60s threshold is reached', async () => {
    await setupWithFakeIdleInterval();
    await act(async () => { await vi.advanceTimersByTimeAsync(45 * 1000); });
    expect(hasListener('meds')).toBe(true);
  });

  it('resumes instantly on real activity, not waiting for the next 15s poll', async () => {
    await setupWithFakeIdleInterval();
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000 + 15000); });
    expect(hasListener('meds')).toBe(false);
    act(() => document.dispatchEvent(new Event('pointerdown')));
    expect(hasListener('meds')).toBe(true);
  });
});
