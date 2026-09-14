import { medColor } from '../utils/color';

/** Small per-drug color dot — same `code` always renders the same color everywhere it
 * appears, so two rows never read as "probably the same thing" at a glance. See utils/color.ts
 * for why this exists (look-alike/sound-alike drug name mix-ups). */
export function MedDot({ code, size = 9 }: { code: string; size?: number }) {
  return (
    <span
      style={{
        display: 'inline-block', flex: 'none', width: size, height: size, borderRadius: '50%',
        background: medColor(code), boxShadow: '0 0 0 2px rgba(255,255,255,.6)',
      }}
    />
  );
}
