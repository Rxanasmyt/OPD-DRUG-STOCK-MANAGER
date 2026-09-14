import { describe, it, expect } from 'vitest';
import { loadMasterMeds, seedLots } from './seed';

// Regression guard for a real, reported issue: seedInitialData() (this module's output) is the
// ACTUAL first-time-setup path wired to HomeScreen's "โหลดข้อมูลตั้งต้น" button for a genuinely
// new hospital deployment — not a demo/test fixture. It used to fabricate plausible-looking
// random floor quantities and entire fake lot records (lot no./expiry/qty) so a first-run demo
// had something to look at. On a real deployment that's actively wrong: nobody has physically
// counted a single tablet through the system yet, so every quantity must start at 0 and force a
// real count, never quietly inherit a number nobody actually counted.
describe('loadMasterMeds', () => {
  const meds = loadMasterMeds();

  it('starts every med at floor 0, active or not', () => {
    expect(meds.length).toBeGreaterThan(0);
    for (const m of meds) expect(m.floor).toBe(0);
  });

  it('never sets lastCountTs — nothing has actually been counted yet', () => {
    for (const m of meds) expect(m.lastCountTs).toBeUndefined();
  });

  it('still seeds real par targets/usage estimates for active meds (starting CONFIGURATION, not a stock claim)', () => {
    const active = meds.filter((m) => m.active);
    expect(active.length).toBeGreaterThan(0);
    for (const m of active) {
      expect(m.parSub).toBeGreaterThan(0);
      expect(m.parFloor).toBeGreaterThan(0);
    }
  });

  it('leaves an inactive (not-carried) med with zeroed par too', () => {
    const inactive = meds.find((m) => !m.active);
    if (inactive) {
      expect(inactive.parSub).toBe(0);
      expect(inactive.parFloor).toBe(0);
    }
  });
});

describe('seedLots', () => {
  it('never fabricates a lot record — a real deployment has none to seed yet', () => {
    const meds = loadMasterMeds();
    expect(seedLots(meds)).toEqual([]);
  });
});
