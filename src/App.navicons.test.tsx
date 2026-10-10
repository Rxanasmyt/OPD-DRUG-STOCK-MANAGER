// Regression for a real-world request with a screenshot from an actual device: "อยากให้ดูดีกว่านี้
// มากๆๆ" — the bottom nav's 5 icons used to be plain Unicode geometric/arrow symbols (▤ ⇄ ⇩ ⬓ ≡),
// each from a different Unicode symbol block with its own stroke weight — visibly mismatched on
// a real phone (one bold/filled glyph next to several thin ones), the one place in the app not
// using the same emoji "icon language" every other screen already does (see MoreScreen.tsx's own
// menu). Swapped for emoji — this locks in the exact set so it can't silently drift back to the
// old mismatched symbols, and that the SAME emoji is reused everywhere the SAME action/meaning
// appears (HomeScreen's two quick-action buttons, QrModal's scan-purpose theme) rather than
// introducing a second, different icon for one meaning.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { renderWithApp } from './test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from './test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('App — bottom nav icon consistency regression', () => {
  it('uses one emoji per nav tab, never the old mismatched Unicode symbols', async () => {
    renderWithApp(<App />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // At least one active med, so HomeScreen renders its normal dashboard (with the two
    // quick-action buttons this test checks) instead of the "ยังไม่มีข้อมูลยาในระบบ" empty state.
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    const nav = await screen.findByRole('navigation');
    const navText = nav.textContent || '';
    expect(navText).toContain('🏠');
    expect(navText).toContain('🔄');
    expect(navText).toContain('🔃');
    expect(navText).toContain('📦');
    expect(navText).toContain('⚙️');
    for (const old of ['▤', '⇄', '⇩', '⬓', '≡']) {
      expect(navText).not.toContain(old);
    }

    // HomeScreen's own two quick-action buttons reuse the SAME 🔄/📦 icons as the nav tabs
    // they lead to — same meaning, same glyph, not a second icon invented for it.
    const homeMain = document.querySelector('main') as HTMLElement;
    expect(within(homeMain).getAllByText('🔄').length).toBeGreaterThan(0);
    expect(within(homeMain).getAllByText('📦').length).toBeGreaterThan(0);
  });
});
