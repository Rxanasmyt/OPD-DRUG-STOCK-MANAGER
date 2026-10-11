// Regression test for a real audit finding: the main AppContext value is one monolithic object
// memoized with `state` itself as a dependency, so every patch() ANYWHERE in the app (a
// keystroke, a cart qty bump, anything) produces a brand-new context value — every one of this
// app's ~40 useApp() consumers re-renders because of it, including components with nothing to
// do with whatever actually changed. ChromeCtx (AppContext.tsx) is a narrower, separately-
// memoized companion context for the handful of always-mounted "chrome" components (Toast,
// IdleLogoutWarning, UpdateBanner) that sit at the root for the whole session regardless of
// screen — this locks in that reading it via useChrome() instead of useApp() actually stops
// those components from re-rendering on an unrelated state change, while still re-rendering
// when something they actually read (toast) changes.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp, useChrome } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// setCartQty caps the typed quantity at substock's own qty (subQty) — without a lot seeded, it
// would silently cap to 0 and delete the cart entry instead of setting it, which has nothing to
// do with what this test is actually checking.
const LOT = { id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 };

// Re-executes its body exactly once per actual React render — the real observable signal that
// this component re-rendered, not an implementation-detail spy on useChrome() itself.
let chromeRenderCount = 0;
function ChromeRenderCounter() {
  const { toast } = useChrome();
  chromeRenderCount++;
  return <div data-testid="chromeToastValue">{toast ?? ''}</div>;
}

// Drives state changes that have NOTHING to do with ChromeCtx's own slice (toast/idleWarnVisible/
// qrOpen/updateAvailable) — a cart qty bump is exactly the kind of everyday, high-frequency
// action (search typing, filter taps, cart edits) this fix targets.
function UnrelatedActionHarness() {
  const { state, setCartQty, toast } = useApp();
  return (
    <>
      <button onClick={() => setCartQty(MED.id, '7')}>bump-cart</button>
      <button onClick={() => toast('สวัสดี')}>fire-toast</button>
      <div data-testid="cartQty">{state.cart[MED.id] ?? ''}</div>
    </>
  );
}

describe('ChromeCtx — scoped re-render fix regression', () => {
  it('does not re-render a chrome-only consumer when an unrelated state field changes, but does when toast changes', async () => {
    chromeRenderCount = 0;
    const user = userEvent.setup();
    renderWithApp(<><ChromeRenderCounter /><UnrelatedActionHarness /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [LOT]);

    const countAfterMount = chromeRenderCount;

    // Bumping cart qty patches `state.cart` — ChromeCtx's own 4 fields are all unaffected.
    // Without the fix (reading useApp() directly), this would increment chromeRenderCount too.
    await user.click(screen.getByRole('button', { name: 'bump-cart' }));
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('7'));
    expect(chromeRenderCount).toBe(countAfterMount);

    // Firing a toast DOES touch ChromeCtx's own slice — this must still re-render.
    await user.click(screen.getByRole('button', { name: 'fire-toast' }));
    await waitFor(() => expect(screen.getByTestId('chromeToastValue').textContent).toBe('สวัสดี'));
    expect(chromeRenderCount).toBeGreaterThan(countAfterMount);
  });
});
