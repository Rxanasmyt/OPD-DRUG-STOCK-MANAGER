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
// Bug fix (accessibility): every severity signal in the app (toneFor/subTone in selectors.ts)
// is color ONLY — a red/amber/green traffic light with nothing else distinguishing the bands.
// For someone with red-green color blindness (the most common form, ~5-8% of men), a "ปกติ"
// shelf and an "ต่ำมาก" one can look the same at a glance. toneFor()/subTone() only ever return
// one of these three exact CSS variable strings, so map them back to a shape as well — color
// stays the primary/fast read for everyone else, the glyph is what makes it not color-only.
export function severityIcon(tone: string): string | null {
  if (tone === 'var(--red)') return '●';
  if (tone === 'var(--amber)') return '◆';
  if (tone === 'var(--green)') return '✓';
  return null;
}

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
  const icon = tone ? severityIcon(tone) : null;
  return (
    <>
      <span
        style={{
          // Stability pass (real-world request: "การจดสีไม่กระโดดเวลาข้อมูล real-time เปลี่ยน") —
          // a live figure crossing a par threshold (ปกติ → เริ่มต่ำ → วิกฤต) used to snap straight
          // to its new color the instant Firestore's onSnapshot delivered the change, with
          // nothing else on screen to soften a hard color cut. A short color fade reads as "this
          // eased into its new state" instead of "this glitched," the same way qtyPulse's scale-
          // pop already softens the number itself changing.
          fontWeight: 800, color: tone || 'inherit', fontSize: size, display: 'inline-block',
          transition: 'color var(--dur) var(--ease)',
          animation: pulsing ? 'qtyPulse .55s var(--ease-spring)' : undefined,
        }}
      >
        {icon && <span style={{ fontSize: Math.max(9, size * 0.6), marginRight: 2, verticalAlign: 'middle' }} aria-hidden="true">{icon}</span>}
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
export function DeficitBadge({ amount, unit, urgent, packSize }: { amount: number; unit?: string; urgent?: boolean; packSize?: number }) {
  if (amount <= 0) return null;
  const tone = urgent ? 'var(--red)' : 'var(--amber)';
  const bg = urgent ? 'var(--red-bg)' : 'var(--amber-bg)';
  // Real-world request: "...ถ้ามีหน่วยเป็นกล่อง บอกรายละเอียดกล่องละเท่าไร ต้องเติมกี่กล่อง...
  // เนื่องจากการทำงานจริงเบิกยาและเติมหน้างานเป็นกล่องๆ" — a box-only med (Med.packSize set) is
  // physically picked/counted in whole boxes, not loose units; showing only the raw unit deficit
  // (e.g. "ต้องเติม 75 เม็ด") leaves the real mental math (how many boxes, how many loose) to
  // whoever's actually filling the shelf, every single time. Exact split, never rounded away —
  // same reasoning as printTodayReplenishList's own "Bug fix" comment on this class of gap — the
  // deficit itself isn't guaranteed to land on a clean multiple of packSize.
  const boxNote = packSize && packSize > 1 ? (() => {
    const boxes = Math.floor(amount / packSize);
    const rem = amount % packSize;
    const u = unit || '';
    return boxes > 0
      ? nf(boxes) + ' กล่อง' + (rem > 0 ? ' + ' + nf(rem) + ' ' + u : '')
      : nf(rem) + ' ' + u + ' (ไม่ครบ 1 กล่อง — กล่องละ ' + nf(packSize) + ')';
  })() : null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: bg, color: tone, fontWeight: 800, fontSize: 11, padding: '2.5px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      ▲ ต้องเติม {nf(amount)}{unit ? ' ' + unit : ''}{boxNote ? ' (' + boxNote + ')' : ''}
    </span>
  );
}

/**
 * Real-world request: "หน้าเติมยาเข้าขั้นหน้างาน และเบิกเข้า substock อยากให้มีรายละเอียดว่า 1
 * กล่องมีจำนวนยาเท่าไร...ให้ทุกคนรู้ได้ว่า 1 กล่องจำนวนเท่าไร" — DeficitBadge (above) and
 * ReceiveScreen's own boxRequestNote already show a box breakdown, but ONLY once there's an
 * actual deficit/shortfall to fill right now (amount/need <= 0 → neither renders anything) — a
 * shelf that happens to already be at/above its own reorder point goes back to showing NO
 * box-size info at all, even though "1 กล่อง = 10 เม็ด" is a fixed fact about the drug, not
 * something tied to today's stock level, and is exactly the kind of thing anyone picking/
 * counting this med should be able to see at a glance regardless of whether it's short right
 * now. Unconditional on need — the only condition is the med actually being a boxed one
 * (Med.packSize set) at all. */
export function PackSizeBadge({ packSize, unit }: { packSize?: number; unit: string }) {
  if (!packSize || packSize <= 1) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink)', background: 'var(--bg-subtle)', padding: '2.5px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      📦 กล่องละ {nf(packSize)} {unit}
    </span>
  );
}

/**
 * Real-world request: "ควรปรับปรุงอะไรเพิ่มเติมอีกมั้ยครับในการเติมยาหน้างาน เติมยาเข้าคลัง
 * การนับสต็อกยา" — TransferScreen/ReceiveScreen/CountScreen all show Min/Max/par (fixed
 * targets), but none of them ever surfaced daysOfStockLeft() (selectors.ts) — a number this app
 * already computes from real usage (ReportScreen's turnover/insights tabs) but never carried
 * over to the three screens someone actually decides "what to fill/request/expect right now"
 * from. A fast-moving drug sitting just above Min reads as "fine" by the bar alone even with
 * only a few days of real runway left; a slow-moving one further below Min can have weeks to
 * spare — Min/Max alone can't tell those apart, only the real usage rate can. null (no usage
 * data yet — used30<=0) renders nothing, same "don't show a number this can't back up" rule
 * every other conditional badge here already follows.
 */
export function DaysLeftBadge({ days }: { days: number | null }) {
  if (days === null) return null;
  // Thresholds keyed to how these three screens actually work: floor gets refilled on demand
  // (เติมหน้างาน, effectively daily), substock on the ~2-week central-warehouse request cycle
  // (see ReceiveScreen's own "รอบ 2 สัปดาห์" comment) — ≤3 days is "won't make it to the next
  // routine top-up," ≤7 is "cutting it close," anything past that is informational, not urgent
  // (no red/amber alarm competing with the real Min/Max severity color already on the row).
  const tone = days <= 3 ? 'var(--red)' : days <= 7 ? 'var(--amber)' : 'var(--muted)';
  const bg = days <= 3 ? 'var(--red-bg)' : days <= 7 ? 'var(--amber-bg)' : 'var(--bg-subtle)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: bg, color: tone, fontWeight: 700, fontSize: 11, padding: '2.5px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      ⏳ เหลือใช้ ~{nf(Math.max(0, days))} วัน
    </span>
  );
}
