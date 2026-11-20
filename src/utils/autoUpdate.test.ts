import { describe, it, expect } from 'vitest';
import { safeToAutoUpdate } from './autoUpdate';

const idle = { busy: {}, qrOpen: false, confirmOpen: false, promptOpen: false, activeTag: 'BODY', activeHasText: false };
describe('safeToAutoUpdate', () => {
  it('applies immediately when idle', () => { expect(safeToAutoUpdate(idle)).toBe(true); });
  it('waits while any write is in flight', () => { expect(safeToAutoUpdate({ ...idle, busy: { reconcile: true } })).toBe(false); });
  it('ignores finished busy flags', () => { expect(safeToAutoUpdate({ ...idle, busy: { reconcile: false } })).toBe(true); });
  it('waits while the scanner or a dialog is open', () => {
    expect(safeToAutoUpdate({ ...idle, qrOpen: true })).toBe(false);
    expect(safeToAutoUpdate({ ...idle, confirmOpen: true })).toBe(false);
    expect(safeToAutoUpdate({ ...idle, promptOpen: true })).toBe(false);
  });
  it('waits while someone has typed text in a field, but not for an empty focused field', () => {
    expect(safeToAutoUpdate({ ...idle, activeTag: 'INPUT', activeHasText: true })).toBe(false);
    expect(safeToAutoUpdate({ ...idle, activeTag: 'TEXTAREA', activeHasText: true })).toBe(false);
    expect(safeToAutoUpdate({ ...idle, activeTag: 'INPUT', activeHasText: false })).toBe(true);
  });
});
