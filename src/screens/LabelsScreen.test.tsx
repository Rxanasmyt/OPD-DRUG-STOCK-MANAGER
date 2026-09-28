// Regression test for a real user-reported bug: on the ฉลากตัวยา (med label) tab's shelf-code
// picker, searching a bin code like "a1" matched a shared med by EITHER its OPD-side or its
// IPD-side bin, regardless of which เฉพาะ OPD/เฉพาะ IPD scope chip was selected — a shared med
// with OPD bin "M6" and IPD bin "A1" showed up when searching "a1" even while เฉพาะ OPD was
// selected, mixing two unrelated physical shelves (that happen to share the same literal code)
// into one search result. See LabelsScreen.tsx's binOf/binCodesOf bug-fix comments.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import LabelsScreen from './LabelsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const SHARED_MED = {
  id: 'm1', code: 'MED-0001', name: 'Zocovin (Acyclovir)', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, shared: true, ward: 'opd',
  parSub: 500, parFloor: 100, floor: 40, bin: 'M6', binIpd: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const OPD_MED = {
  id: 'm2', code: 'MED-0002', name: 'Chloroquine 250mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, ward: 'opd',
  parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('LabelsScreen — bin-search ward-scope regression', () => {
  it('scopes the shelf-code picker search to the selected เฉพาะ OPD/เฉพาะ IPD chip', async () => {
    renderWithApp(<LabelsScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [SHARED_MED, OPD_MED]);
    fireCollection('lots', []);

    const search = screen.getByPlaceholderText('ชื่อยา, รหัสชั้น (J4) หรือช่วงชั้น (A1-A7)');

    // 'all' (default) scope: searching "a1" matches BOTH the shared med (its IPD-side "A1")
    // and the plain OPD med (its only bin, "A1") — this part of the old behavior is correct
    // and must keep working once scoped search is added.
    fireEvent.change(search, { target: { value: 'a1' } });
    await screen.findByText('Zocovin (Acyclovir)');
    expect(screen.getByText('Chloroquine 250mg')).toBeInTheDocument();

    // Scope to เฉพาะ OPD: the shared med's OPD-side bin is "M6", not "A1" — it must drop out
    // of the "a1" search entirely (the bug: it used to still match via its IPD-side bin).
    fireEvent.click(screen.getByRole('button', { name: 'เฉพาะ OPD' }));
    await waitFor(() => expect(screen.queryByText('Zocovin (Acyclovir)')).not.toBeInTheDocument());
    expect(screen.getByText('Chloroquine 250mg')).toBeInTheDocument();

    // Scope to เฉพาะ IPD: only the shared med has an IPD-side bin at all ("A1") — the plain
    // OPD-only med (no binIpd) must drop out, and the shared med must now match.
    fireEvent.click(screen.getByRole('button', { name: 'เฉพาะ IPD' }));
    await screen.findByText('Zocovin (Acyclovir)');
    expect(screen.queryByText('Chloroquine 250mg')).not.toBeInTheDocument();
  });
});
