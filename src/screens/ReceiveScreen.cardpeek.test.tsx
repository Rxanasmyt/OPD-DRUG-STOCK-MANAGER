// Regression test for a real usability finding: CardPeekButton (the small 📋 "ดูบัตรสต็อก" icon
// button nested in every "ควรเบิกจากคลังใหญ่"/search-result row) used to be sized 30x30px —
// noticeably under this app's own ~44px tap-target convention (every other button on this
// screen, and the row it sits inside, is 44px+), a real mis-tap risk on a tablet used one-handed
// in a hurry. See ReceiveScreen.tsx's own "Bug fix (usability)" comment on CardPeekButton.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReceiveScreen from './ReceiveScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const NEEDS_RECEIVE_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('ReceiveScreen — CardPeekButton tap-target-size regression', () => {
  it('sizes the 📋 stock-card button to at least the app\'s 44px tap-target convention', async () => {
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NEEDS_RECEIVE_MED]);
    fireCollection('lots', []);
    fireCollection('pendingReceives', []);

    const btn = await screen.findByLabelText('ดูบัตรสต็อก ' + NEEDS_RECEIVE_MED.name);
    // Without the fix, this would be 30px — well under the 44px a rushed one-handed tap needs.
    expect(btn.style.minHeight).toBe('44px');
    expect(btn.style.minWidth).toBe('44px');
  });
});
