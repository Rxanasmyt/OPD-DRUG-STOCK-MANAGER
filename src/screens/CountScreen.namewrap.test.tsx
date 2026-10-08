// Regression test for a real-device report (screenshot): a long drug name on this screen's
// title line overlapped the กล่อง/เศษ/+ count fields next to it on a real phone — the title line
// had no flexWrap, and a flex item defaults to min-width:auto (won't shrink below its own
// content's natural width), so the line overflowed sideways past the column edge instead of
// wrapping onto a second line. See CountScreen.tsx's own "Bug fix (real-device report, mobile
// overlap)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import CountScreen from './CountScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'HALOPERIDOL PL 2 mg. เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1000, parFloor: 1000, floor: 120, bin: 'C4-6',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('CountScreen — long drug name mobile-overlap regression', () => {
  it('wraps the title line (flexWrap) instead of letting the name overflow past the column', async () => {
    renderWithApp(<CountScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    const nameEl = await screen.findByText(MED.name);
    // The nearest ancestor that's a flex row must also wrap — otherwise a long name has nowhere
    // to go but overflow sideways under the count fields painted next to it.
    let el: HTMLElement | null = nameEl;
    let flexRow: HTMLElement | null = null;
    while (el && !flexRow) {
      if (el.style.display === 'flex') flexRow = el;
      el = el.parentElement;
    }
    expect(flexRow).not.toBeNull();
    expect(flexRow?.style.flexWrap).toBe('wrap');
  });
});
