import { wardOf, isSharedMed } from '../store/selectors';
import type { Med, Ward } from '../types';

// Same OPD/green · IPD/purple convention used everywhere else this distinction is drawn
// (HomeScreen, TransferScreen, MedsScreen, LabelsScreen, ReportScreen) — kept here once so
// every med-picker across the app reads it the same way.
const WARD_COLOR: Record<Ward, string> = { opd: 'var(--green)', ipd: 'var(--ipd)' };
const WARD_BG: Record<Ward, string> = { opd: 'var(--green-tint)', ipd: 'var(--ipd-bg)' };
const WARD_SHORT: Record<Ward, string> = { opd: 'OPD', ipd: 'IPD' };

/**
 * A small colored OPD/IPD pill — the fix for "แยกโซนของ substock OPD และ IPD ให้ชัดเจน":
 * OPD and IPD copies of the same drug deliberately share a name (own record, own bin/QR/par
 * — see wardOf), so a plain name-only list is genuinely ambiguous about which shelf a row
 * belongs to. Every med-picker dropdown and selected-med chip should carry this so nobody
 * can pick/confirm the wrong ward's shelf without noticing.
 */
export function WardBadge({ med, size = 'sm' }: { med: Med; size?: 'sm' | 'md' }) {
  // A shared med (see isSharedMed) has no single real ward — it's both — so a badge always
  // reading "OPD" for it (wardOf()'s internal default) would misrepresent it as OPD-only.
  // Now that most drugs are shared by default (see MedsScreen's blankForm), showing "OPD" on
  // nearly every row was also just clutter with no real disambiguating value left — only the
  // still-genuinely-separate minority need this badge at all.
  if (isSharedMed(med)) return null;
  const w = wardOf(med);
  const small = size === 'sm';
  return (
    <span
      style={{
        flex: 'none', fontWeight: 800, color: WARD_COLOR[w], background: WARD_BG[w],
        fontSize: small ? 9.5 : 10.5, padding: small ? '1.5px 6px' : '2px 7px', borderRadius: 20, letterSpacing: '.02em',
      }}
    >
      {WARD_SHORT[w]}
    </span>
  );
}
