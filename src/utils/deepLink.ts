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
    return /^\d{4}-\d{2}$/.test(v.month) ? v : null;
  } catch { return null; }
}
