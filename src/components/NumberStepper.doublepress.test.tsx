// Regression test for a real audit finding: a second pointerdown landing on the same +/- button
// before the first press's pointerup ever fires (two fingers briefly on the same button — real
// at a busy counter with gloved hands) used to overwrite held.current with the new press's
// timers, orphaning the first press's still-pending setTimeout. That orphaned timeout fires
// later and starts its OWN setInterval, which can end up uncleared even after both pointerup
// events have already landed — silently bumping the value forever in the background.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NumberStepper } from './NumberStepper';

describe('NumberStepper — overlapping-press (double pointerdown) regression', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('never leaves an uncleared interval running after both presses release', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<NumberStepper value="10" onChange={onChange} unit="เม็ด" />);
    const plus = screen.getByRole('button', { name: /เพิ่ม/ });

    // First press starts (immediate +1, then a 450ms timer to start repeating).
    fireEvent.pointerDown(plus);
    // A second press lands on the SAME button before the first one's pointerup —
    // the old code overwrote held.current here, orphaning the first press's timeout.
    vi.advanceTimersByTime(10);
    fireEvent.pointerDown(plus);

    // Both fingers lift shortly after — well before either press's own 450ms repeat-start timer
    // would fire on its own.
    vi.advanceTimersByTime(20);
    fireEvent.pointerUp(plus);
    fireEvent.pointerUp(plus);

    // Without the fix, the FIRST press's orphaned 450ms timeout (still pending, scheduled at
    // t=0, nothing left tracking it after the second pointerdown overwrote held.current) fires
    // at t=450 and starts its own setInterval that nothing can ever clear — the value keeps
    // climbing forever even though the user released both fingers at t≈30.
    const callsAtRelease = onChange.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(onChange.mock.calls.length).toBe(callsAtRelease);
  });
});
