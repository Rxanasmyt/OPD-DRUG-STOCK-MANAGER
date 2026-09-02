import { nf } from '../utils/format';

/**
 * A quantity number, colored by severity (tone) and weighted bold so it reads at a glance
 * from across the counter — the whole point of the "เห็นชัดเจนว่าเหลือยาเท่าไร" request. Used
 * anywhere a stock figure (หน้างาน, substock) appears next to its label, instead of every
 * screen inlining its own ad-hoc `<span>` with inconsistent weight/size.
 */
export function Qty({ value, unit, tone, size = 13 }: { value: number; unit?: string; tone?: string; size?: number }) {
  return (
    <>
      <span style={{ fontWeight: 800, color: tone || 'inherit', fontSize: size }}>{nf(value)}</span>
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
