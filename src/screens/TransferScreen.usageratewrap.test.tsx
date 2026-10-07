// Regression test for a real-device report: on a phone, UsageRateBadge (pushed to the title
// line's right edge via marginLeft:auto, a non-wrapping flex row that a long drug name already
// fills) had nowhere to go but overflow sideways, visually landing on top of the qty stepper
// next to it. Moved into the row's existing flexWrap badge row instead — this asserts it lives
// there now, not in the crowded title line.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Oseltamivir - PL 30 mg. capsule', unit: 'capsule', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 25, bin: 'A1',
  used30: 300, usedPrev30: 0, volatility: 1,
};

describe('TransferScreen — UsageRateBadge mobile-overlap regression', () => {
  it('places the usage-rate badge in the wrapping badge row, not the non-wrapping title line', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    const badge = await screen.findByText(/เม็ด\/วัน|capsule\/วัน/);
    // Walk up to the nearest ancestor that actually wraps — the title line (fontSize 14, no
    // flexWrap) must NOT be that ancestor; the badge row below it (flexWrap: 'wrap') must be.
    let el: HTMLElement | null = badge;
    let wrappingAncestor: HTMLElement | null = null;
    while (el && !wrappingAncestor) {
      if (el.style.flexWrap === 'wrap') wrappingAncestor = el;
      el = el.parentElement;
    }
    expect(wrappingAncestor).not.toBeNull();
  });
});
