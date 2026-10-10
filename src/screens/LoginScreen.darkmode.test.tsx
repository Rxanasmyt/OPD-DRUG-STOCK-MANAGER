// Regression for a real contrast bug found by actually screenshotting the app (real-world
// request: "หน้า Login...ยังไม่สวยเลย") — LoginScreen.tsx used to color every foreground element
// sitting on var(--login-bg) with var(--ink-soft)/var(--ink). Those two tokens deliberately
// INVERT meaning between light/dark mode everywhere else in the app (they pair with surfaces
// like var(--green)/var(--bg-card) that also flip brightness between themes) — but
// var(--login-bg)'s own dark variant stays dark rather than brightening, so pairing it with the
// inverting tokens dropped the computed contrast ratio to ~1.1:1 in dark mode (WCAG AA needs
// 4.5:1), including the actual typed text inside the username/password fields. Fixed by
// introducing --login-ink/--login-ink-contrast (styles.css :root, deliberately NOT redefined in
// [data-theme='dark']) and switching every LoginScreen.tsx foreground color to them. This test
// doesn't compute real contrast (jsdom never resolves CSS custom properties to colors) — it
// locks in that the component references the new, theme-stable tokens and never regresses back
// to the inverting ones, on exactly the elements the real screenshot review flagged.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import LoginScreen from './LoginScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { fireAuth } from '../test-utils/firebaseTestDouble';

describe('LoginScreen — dark-mode contrast regression', () => {
  it('colors the submit button, segmented control, and input fields with the theme-stable --login-ink tokens, never --ink/--ink-soft', async () => {
    renderWithApp(<LoginScreen />);
    fireAuth(null); // settles authStatus: 'loading' -> 'signedOut', same as a real cold load with nobody signed in
    await waitFor(() => expect(screen.getByText('KPNHOS')).toBeInTheDocument());

    const submit = document.querySelector('button[type="submit"]') as HTMLElement;
    expect(submit).not.toBeNull();
    expect(submit.getAttribute('style')).toContain('var(--login-ink)');
    expect(submit.getAttribute('style')).toContain('var(--login-ink-contrast)');
    expect(submit.getAttribute('style')).not.toMatch(/var\(--ink-soft\)|var\(--ink\)[^-]/);

    // The real regression: the TYPED TEXT color inside the fields themselves was unreadable.
    const usernameInput = document.querySelector('input.login-field') as HTMLElement;
    expect(usernameInput).not.toBeNull();
    expect(usernameInput.getAttribute('style')).toContain('var(--login-ink)');
    expect(usernameInput.getAttribute('style')).not.toContain('var(--ink-soft)');

    const loginTab = screen.getAllByRole('button', { name: 'เข้าสู่ระบบ' }).find((b) => b.getAttribute('type') !== 'submit')!;
    expect(loginTab.getAttribute('style')).toContain('var(--login-ink-contrast)');
  });
});
