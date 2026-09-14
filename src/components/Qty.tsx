import { useEffect, useRef, useState } from 'react';
import { nf } from '../utils/format';

/**
 * A quantity number, colored by severity (tone) and weighted bold so it reads at a glance
 * from across the counter — the whole point of the "เห็นชัดเจนว่าเหลือยาเท่าไร" request. Used
 * anywhere a stock figure (หน้างาน, substock) appears next to its label, instead of every
 * screen inlining its own ad-hoc `<span>` with inconsistent weight/size.
 *
 * Every one of these is fed by a live Firestore onSnapshot — the whole point of this app being
 * real-time across devices — but nothing ever showed that a number had actually just changed
 * because of that: a pharmacist at the counter and a tech in the substock room both watching
 * the same drug's card would see the figure silently morph mid-glance with zero indication
 * "that just moved, someone else did something." A brief scale-pop on a genuine value change
 * (never on first mount, and never a false trigger from an unrelated realtime update to some
 * other field of the same doc — see the effect's own guard) makes a real-time update actually
 * register as one, instead of reading identically to the number just happening to be that.
 */
export function Qty({ value, unit, tone, size = 13 }: { value: number; unit?: string; tone?: string; size?: number }) {
  const prevRef = useRef(value);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (prevRef.current === value) return;
    prevRef.current = value;
    setPulsing(true);
    const t = window.setTimeout(() => setPulsing(false), 550);
    return () => window.clearTimeout(t);
  }, [value]);
  return (
    <>
      <span
        style={{
          fontWeight: 800, color: tone || 'inherit', fontSize: size, display: 'inline-block',
          animation: pulsing ? 'qtyPulse .55s var(--ease-spring)' : undefined,
        }}
      >
        {nf(value)}
      </span>
      {unit && <span className="muted" style={{ fontSize: size - 1.5 }}> {unit}</span>}
    </>
  );
}

/**
 * The "ต้องเพิ่มเท่าไร" pill — only renders when there's actually a deficit (amount > 0), so
 * a fully-stocked row just doesn't show one rather than showing "+0". Red/amber by how
 * urgent, matching the same severity language as toneFor()'s bar-fill color elsewhere.
 */
export function DeficitBadge({ amount, unit, urgent }: { amount: number; unit?: string; urgent?: boolean }) {
  if (amount <= 0) return null;
  const tone = urgent ? 'var(--red)' : 'var(--amber)';
  const bg = urgent ? 'var(--red-bg)' : 'var(--amber-bg)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: bg, color: tone, fontWeight: 800, fontSize: 11, padding: '2.5px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      ▲ ต้องเติม {nf(amount)}{unit ? ' ' + unit : ''}
    </span>
  );
}
