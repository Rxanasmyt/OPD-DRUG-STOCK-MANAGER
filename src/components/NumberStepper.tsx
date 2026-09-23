import { useEffect, useRef } from 'react';

// A short, neutral tick distinct from hapticSuccess()/hapticError() in utils/haptic.ts — this
// fires many times per press-and-hold, so it needs to read as "counting up", not as a
// success/failure signal repeated rapidly.
function hapticTick(): void {
  try { navigator.vibrate?.(8); } catch { /* unsupported — silently do nothing */ }
}

/**
 * +/- stepper flanking a numeric text input — tap for ±1 (or ±`step`), press-and-hold to repeat
 * with acceleration (starts slow, speeds up after the first second, matching how a phone's
 * native volume/stepper controls feel). The text input stays fully editable by hand too — this
 * is an addition for fast one-handed adjustment at the counter, not a replacement for typing an
 * exact number someone already knows.
 */
export function NumberStepper({ value, onChange, unit, step = 1, min = 0, max, inputStyle }: {
  /** Current value as the same raw string the rest of the app's qty fields already use
   * (digitsOnly-filtered by the caller's own setter — see setAdjQty/setRecvQty). */
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  inputStyle?: React.CSSProperties;
}) {
  const held = useRef<{ timeout: number; interval: number } | null>(null);
  // Bug fix: a held-down repeat's setInterval callback is created ONCE, at the moment the press
  // starts, and keeps calling that same closure for the rest of the hold — but `value` is a
  // prop that changes on every tick (each bump() calls onChange(), which re-renders this
  // component with a new `value`). Without this ref, every repeat kept reading the STALE
  // `value` from the instant the press began, so `cur` never advanced past that original
  // number and the whole hold only ever incremented once no matter how long it was held —
  // confirmed live: a real ~1.1s press only moved the count by 1 instead of the expected ~8.
  const valueRef = useRef(value);
  valueRef.current = value;

  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  const bump = (dir: 1 | -1) => {
    const cur = parseInt(valueRef.current, 10) || 0;
    const next = clamp(cur + dir * step);
    if (next !== cur) { onChange(String(next)); hapticTick(); }
  };

  const startHold = (dir: 1 | -1) => {
    bump(dir);
    // First repeat after a real pause (so a normal tap never double-fires), then speeds up —
    // matches native stepper/volume-button feel instead of firing at one flat rate.
    const timeout = window.setTimeout(() => {
      const interval = window.setInterval(() => bump(dir), 90);
      held.current = { timeout, interval };
    }, 450);
    held.current = { timeout, interval: -1 };
  };
  const stopHold = () => {
    if (!held.current) return;
    window.clearTimeout(held.current.timeout);
    if (held.current.interval !== -1) window.clearInterval(held.current.interval);
    held.current = null;
  };
  // Press-and-hold shouldn't keep firing after this component unmounts (e.g. the person
  // navigates away mid-hold) or the finger drags off-button without a pointerup ever landing.
  useEffect(() => stopHold, []);

  const btnStyle: React.CSSProperties = {
    flex: 'none', width: 48, minHeight: 48, border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--green)', fontSize: 22, fontWeight: 700, borderRadius: 10, display: 'flex',
    alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation', userSelect: 'none',
  };

  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
      <button
        type="button"
        aria-label={'ลด' + (unit ? ' ' + unit : '') + ' ' + step}
        style={btnStyle}
        onPointerDown={(e) => { e.preventDefault(); startHold(-1); }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      >
        −
      </button>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        style={{ flex: 1, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 17, fontWeight: 600, minHeight: 48, ...inputStyle }}
      />
      <button
        type="button"
        aria-label={'เพิ่ม' + (unit ? ' ' + unit : '') + ' ' + step}
        style={btnStyle}
        onPointerDown={(e) => { e.preventDefault(); startHold(1); }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      >
        +
      </button>
    </div>
  );
}
