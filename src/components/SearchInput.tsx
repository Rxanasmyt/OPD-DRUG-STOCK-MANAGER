import type { CSSProperties } from 'react';

/** Every "ค้นหาชื่อยา" field in the app (Meds, Transfer, Receive, Adjust, Count, WardMove,
 * SubstockCard) was a plain <input> with no way to clear it except selecting the text and
 * deleting by hand — a small but real bit of friction on a touchscreen, several times a shift,
 * on the single most-used control in the app. One shared component instead of re-typing the
 * same input+clear-button markup seven times, so the behavior (and any future tweak to it)
 * stays identical everywhere rather than drifting screen by screen. Wrapper `style` controls
 * layout (flex/minWidth/margin) the way the bare <input> used to; the input itself always
 * fills it and only reserves right-padding for the ✕ once there's something to clear.
 *
 * `onEnter` (optional): every picker screen (รับยาเข้า, ปรับยอด, ย้ายชั้นวาง, บัตรสต็อกยา)
 * already narrows to a dropdown of name matches as you type, but still made you reach over and
 * tap the one result even when your typing had already narrowed it to exactly one — a real tax
 * on the fast-typing/barcode-gun-into-a-text-field case this screen sees a lot. Callers pass a
 * pick action gated to "exactly one match" so ↵ commits it, same as it always could on a native
 * <select>; typing that still matches several/zero does nothing, so it never mis-picks. */
export function SearchInput({
  value, onChange, placeholder, style, inputStyle, autoFocus, onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } } : undefined}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10,
          // Bug fix (mobile fit): iOS Safari auto-zooms the whole page in on focus for any text
          // input with a computed font-size under 16px — since this one component IS the
          // "ค้นหาชื่อยา" field on seven different screens (see doc comment above), that zoom
          // hit the single most-tapped control in the whole app on every iPhone/iPad, every time.
          padding: value ? '11px 38px 11px 13px' : '11px 13px', fontSize: 16, minHeight: 44,
          ...inputStyle,
        }}
      />
      {value && (
        // Bug fix (usability, real-device mobile UX audit): 28px was noticeably under this
        // app's own ~44px tap-target convention (see ReceiveScreen's CardPeekButton) — a real
        // mis-tap risk given this is, per the doc comment above, the single most-tapped control
        // in the whole app. Same fix pattern as CardPeekButton: the button's own hit box grows
        // to 44x44 (transparent, invisible), while the visible circle stays the original 28px
        // so the control doesn't look visually oversized next to the rest of the field.
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="ล้างคำค้นหา"
          className="press-spring"
          style={{
            position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', border: 0,
            background: 'transparent', width: 44, height: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
          }}
        >
          <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-subtle)', color: 'var(--muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</span>
        </button>
      )}
    </div>
  );
}
