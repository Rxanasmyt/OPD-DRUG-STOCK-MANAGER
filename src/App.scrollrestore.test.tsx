// Regression test for a real request: "สามารถกดถอยย้อนกลับได้แบบสะดวก ถอยกลับไปยังหน้าเดิมจุดเดิม
// ได้อย่างรวดเร็ว" — every screen swap replaces the whole content subtree inside one
// never-unmounted <main>, so its scrollTop is a raw pixel value that survives the swap
// untouched by React. Navigating away from a screen scrolled partway down, then back, used to
// leave <main> sitting at that same OLD pixel value against the NEW screen's content — right by
// coincidence if the new screen happens to be at least as tall, but silently WRONG (clamped, or
// just visually arbitrary) the moment an intermediate screen is shorter. See App.tsx's own
// "Real-world request" comment on mainRef/scrollPositions/saveScroll.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { renderWithApp } from './test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from './test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('App — per-screen scroll-position restore regression', () => {
  it('restores the exact scroll position a screen was left at, after navigating away and back', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    // Both the bottom-nav tab AND HomeScreen's own "เติมหน้างาน" quick-action button match a
    // loose text query while on หน้าหลัก — scope to the bottom <nav> specifically, the one
    // element guaranteed present regardless of which screen is showing.
    const nav = await screen.findByRole('navigation');
    await user.click(within(nav).getByRole('button', { name: /เติมหน้างาน/ }));
    const main = document.querySelector('main') as HTMLElement;

    // Simulate having scrolled 300px down the "เติมหน้างาน" list.
    fireEvent.scroll(main, { target: { scrollTop: 300 } });
    expect(main.scrollTop).toBe(300);

    // Navigate away (หน้าหลัก starts fresh at 0 — never scrolled in this test) and back.
    await user.click(within(nav).getByRole('button', { name: /หน้าหลัก/ }));
    expect(main.scrollTop).toBe(0);

    await user.click(within(nav).getByRole('button', { name: /เติมหน้างาน/ }));
    // Without the fix, <main>'s scrollTop is left at whatever หน้าหลัก's own layout clamped it
    // to (0, since หน้าหลัก was never scrolled) — not restored back to the real 300 this screen
    // was actually left at.
    expect(main.scrollTop).toBe(300);
  });
});
