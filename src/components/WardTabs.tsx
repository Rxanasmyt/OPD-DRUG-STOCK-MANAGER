import type { Ward } from '../types';

const OPTS: ['all' | Ward, string][] = [['all', 'ทุกหอผู้ป่วย'], ['opd', 'OPD'], ['ipd', 'IPD']];
const TONE: Record<'all' | Ward, string> = { all: 'var(--ink)', opd: 'var(--green)', ipd: 'var(--ipd)' };

/** The OPD/IPD/ทุกหอผู้ป่วย filter tabs — same three options, same behavior, used on six
 * screens (Home, Receive, Transfer, Adjust, Labels, Report) that all read/write the one
 * shared `state.wardFilter`. Was six copies of near-identical inline JSX, each just snapping
 * the active tab's background on/off with no motion between them. Pulled into one component
 * so the six stay visually identical by construction, and gave it the same sliding-highlight
 * language as the login screen's เข้าสู่ระบบ/สมัครสมาชิก toggle — the pill glides to the new
 * tab instead of the highlight just teleporting, so switching ward reads as a deliberate,
 * visible move rather than a flicker. */
export function WardTabs({ value, onChange, size = 'md' }: { value: 'all' | Ward; onChange: (w: 'all' | Ward) => void; size?: 'sm' | 'md' }) {
  const idx = OPTS.findIndex(([w]) => w === value);
  const sm = size === 'sm';
  return (
    <div style={{ position: 'relative', display: 'flex', gap: 2, background: 'var(--border-soft)', padding: 3, borderRadius: 11 }}>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', top: 3, bottom: 3, left: `calc(${(idx * 100) / OPTS.length}% + 3px)`, width: `calc(${100 / OPTS.length}% - 4px)`,
          background: 'var(--bg-card)', borderRadius: 8, boxShadow: 'var(--shadow-xs)',
          transition: 'left var(--dur-slow) var(--ease-spring)',
        }}
      />
      {OPTS.map(([w, label]) => {
        const active = value === w;
        return (
          <button
            key={w}
            onClick={() => onChange(w)}
            style={{
              position: 'relative', flex: 1, border: 0, background: 'transparent', color: active ? TONE[w] : 'var(--muted)',
              padding: sm ? '7px 0' : '9px 0', borderRadius: 8, fontSize: sm ? 12 : 13, fontWeight: 600, zIndex: 1,
              transition: 'color var(--dur) var(--ease)',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
