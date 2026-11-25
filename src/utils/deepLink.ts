// Links in the LINE monthly returns report open the app at ?r=returns&m=YYYY-MM&v=all|cat|reason. The query string survives
// the login screen by being parked in sessionStorage (and removed from the address bar) at startup, then consumed after sign-in.
import type { ReturnsView } from './returnsSummary';

const KEY = 'opd-returns-deeplink';
export interface ReturnsDeepLink { month: string; view: ReturnsView }

export function parseReturnsDeepLink(search: string): ReturnsDeepLink | null {
  const p = new URLSearchParams(search);
  if (p.get('r') !== 'returns') return null;
  const m = p.get('m') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return null;
  const v = p.get('v');
  return { month: m, view: v === 'cat' || v === 'reason' ? v : 'all' };
}

/** Call once at startup: park a valid deep link and clean the address bar. */
export function captureReturnsDeepLink(): void {
  try {
    const dl = parseReturnsDeepLink(window.location.search);
    if (!dl) return;
    sessionStorage.setItem(KEY, JSON.stringify(dl));
    const p = new URLSearchParams(window.location.search);
    ['r', 'm', 'v'].forEach((k) => p.delete(k));
    const qs = p.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
  } catch { /* storage blocked — the link simply opens the app normally */ }
}

export function hasReturnsDeepLink(): boolean {
  try { return !!sessionStorage.getItem(KEY); } catch { return false; }
}

/** Read AND remove the parked link. */
export function takeReturnsDeepLink(): ReturnsDeepLink | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw) as ReturnsDeepLink;
    if (!/^\d{4}-\d{2}$/.test(v.month)) return null;
    markReturnsMonthSeen(v.month); // opened from the LINE link or the banner — either way this device has seen it
    return v;
  } catch { return null; }
}

// ---- "monthly returns report is ready" banner (per device) ----------------------------------------------------------------------
// The banner stays on the home screen until THIS device has opened that month's report. The only state is the latest month seen,
// kept in localStorage (no server data, so the banner is per browser/device, not per person).
const SEEN_KEY = 'opd-returns-report-seen';
export function getSeenReturnsMonth(): string {
  try { return localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; }
}
/** Remember that `month` (YYYY-MM) was opened; never moves backwards. */
export function markReturnsMonthSeen(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  try { if (month > getSeenReturnsMonth()) localStorage.setItem(SEEN_KEY, month); } catch { /* storage blocked — the banner just stays */ }
}
/** Park a link for ReportScreen to consume (same slot the LINE link uses). */
export function stashReturnsDeepLink(dl: ReturnsDeepLink): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(dl)); } catch { /* ignore */ }
}
