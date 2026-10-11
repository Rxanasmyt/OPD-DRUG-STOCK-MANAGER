// Regression test for an audit finding: the `meds` onSnapshot listener used to cast a raw
// Firestore doc straight to `Med[]` with zero runtime check — a doc with a missing/mistyped
// numeric field (manual Firestore console edit, a partial write, pre-migration data) would
// silently produce an object that lies about its own type, and the resulting NaN/undefined
// would propagate through every sum/comparison that reads it. See AppContext.tsx's `numOr()`
// and its own "Bug fix (type-safety audit)" doc comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

function MedsHarness() {
  const { state } = useApp();
  const m = state.meds.find((x) => x.id === 'm1');
  return <div data-testid="floor">{m ? JSON.stringify(m.floor) : 'none'}</div>;
}

describe('meds onSnapshot — boundary sanitization regression', () => {
  it('defaults a missing/malformed floor to 0 instead of letting it through as undefined/NaN', async () => {
    renderWithApp(<MedsHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));

    // A doc missing `floor` entirely — the exact shape a manual Firestore console edit or a
    // partial/pre-migration write could produce. Without the fix, state.meds[].floor would be
    // `undefined` here (the raw doc has no such field), which NaN-propagates through every sum.
    fireCollection('meds', [{
      id: 'm1', code: 'MED-0001', name: 'PARACETAMOL', unit: 'เม็ด', dosageForm: 'เม็ด',
      price: 1, had: false, active: true, parSub: 100, parFloor: 100, bin: 'A1',
      used30: 0, usedPrev30: 0, volatility: 0,
      // floor intentionally omitted
    }]);

    await waitFor(() => expect(screen.getByTestId('floor').textContent).toBe('0'));
  });
});
