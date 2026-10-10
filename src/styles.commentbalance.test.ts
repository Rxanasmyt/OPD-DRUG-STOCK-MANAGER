import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Regression test for a real production bug (real-world report: "หน้า login ทำให้ดูดีที่สุดได้
// เท่านี้เองหรอครับ"): a doc comment in styles.css once spelled out a literal "--ink" + "*" + "/"
// sequence as prose (a wildcard shorthand for "every --ink-prefixed token"). That two-character
// sequence is CSS's comment-close marker, so it silently terminated the comment early — everything
// from there to the comment's real closing marker got parsed as actual CSS instead of prose, which
// corrupted the very next declaration (--login-ink was dropped; --login-ink-contrast right after
// it survived, since the parser's error recovery resynced on that clean statement). The practical
// effect: every var(--login-ink) use in LoginScreen.tsx — the KPNHOS title, the submit button's
// background, the lock icon, the checkbox accent, the feature-list icons — silently fell back to
// an inherited/initial value (black text, transparent button) instead of the intended off-white,
// in production, for as long as that comment shipped.
//
// A general invariant catches this whole bug class without depending on any particular CSS
// parser's exact (and not-fully-spec'd) error-recovery behavior: the number of comment-openers
// ("/*") must equal the number of comment-closers ("*/") in the file. Any imbalance means either
// a comment was never closed, or — as happened here — something closed one that shouldn't have.
const CSS_PATH = path.resolve(__dirname, './styles.css');

describe('styles.css — comment delimiter balance regression', () => {
  it('has exactly as many comment-open markers as comment-close markers', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const opens = (css.match(/\/\*/g) || []).length;
    const closes = (css.match(/\*\//g) || []).length;
    expect(closes).toBe(opens);
  });
});
