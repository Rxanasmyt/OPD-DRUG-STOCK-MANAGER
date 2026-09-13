// Integration test for the real correctness fix this session made to AdjustScreen: the
// "ปรับยอด" quantity field always means a DELTA to subtract, never the absolute counted
// amount — but its own reason chip ("นับได้ต่างจากระบบ") invites typing the counted number
// directly. This locks in the warning box + per-type label that close that gap, through the
// REAL AppProvider/useApp() plumbing (not a hand-mocked context) via renderWithApp +
// firebaseTestDouble — see those files' own doc comments for how/why.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import AdjustScreen from './AdjustScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

// pickAdjType() (AppContext.tsx) deliberately clears adjMed on every type switch — picking the
// drug is a per-type step in the real screen, not something that carries over. Every test
// below re-picks it after switching, same as an actual user would.
async function pickMed(user: UserEvent) {
  const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
  // adjSearch survives a type switch (only adjMed/adjReason reset — see pickAdjType) and
  // pickAdjMed() leaves the med's full name sitting in the box, so a second pick needs a clear
  // first or the new text just appends onto the old.
  await user.clear(search);
  await user.type(search, 'Paracetamol');
  await user.click(await screen.findByRole('button', { name: new RegExp(MED.name) }));
}

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<AdjustScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  // See hasListener()'s doc comment — the 'meds' subscription only exists once the async
  // signed-in state update above has actually flushed.
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  // adjType starts null (no type picked yet) — the whole form, including the search box, is
  // gated on having one, same as a real user tapping "ปรับยอด" first.
  await user.click(await screen.findByRole('button', { name: /^ปรับยอด/ }));
  await pickMed(user);
  return user;
}

describe('AdjustScreen — ปรับยอด delta-vs-absolute warning', () => {
  it('shows the delta warning and the delta-worded label for "ปรับยอด" (default type)', async () => {
    await setup();
    expect(screen.getByText(/ช่องนี้คือ/)).toBeInTheDocument();
    expect(screen.getByText(/ส่วนต่างที่จะลบออกจากยอดระบบ/)).toBeInTheDocument();
  });

  it('hides the delta warning and shows the addition-worded label for "คืนยา"', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: /^คืนยา/ }));
    await pickMed(user);
    expect(screen.queryByText(/ช่องนี้คือ/)).not.toBeInTheDocument();
    expect(screen.getByText(/จำนวนที่คืน \(จะเพิ่มเข้ายอด\)/)).toBeInTheDocument();
  });

  it('the warning box links to the นับสต็อก screen for entering an absolute count', async () => {
    await setup();
    expect(screen.getByRole('button', { name: /หน้า "นับสต๊อก" แทน/ })).toBeInTheDocument();
  });
});
