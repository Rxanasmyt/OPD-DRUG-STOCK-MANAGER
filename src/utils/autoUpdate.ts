/**
 * When may a freshly-downloaded app version be applied (page reload) WITHOUT asking? Pharmacy staff want
 * every fix live the moment it ships — no banner to tap, no waiting — but a reload must never eat
 * something half-done. So the reload happens at the first moment that is provably idle: no write in
 * flight, no scanner/dialog open, and no one typing in a field. Pure so it is unit-tested.
 */
export interface AutoUpdateProbe {
  busy: Record<string, boolean>;
  qrOpen: boolean;
  confirmOpen: boolean;
  promptOpen: boolean;
  /** document.activeElement's tag + whether it holds typed text */
  activeTag: string | null;
  activeHasText: boolean;
}

export function safeToAutoUpdate(p: AutoUpdateProbe): boolean {
  if (Object.values(p.busy).some(Boolean)) return false;
  if (p.qrOpen || p.confirmOpen || p.promptOpen) return false;
  const typing = (p.activeTag === 'INPUT' || p.activeTag === 'TEXTAREA') && p.activeHasText;
  return !typing;
}

export function probeActiveElement(): { activeTag: string | null; activeHasText: boolean } {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return { activeTag: null, activeHasText: false };
  const v = (el as HTMLInputElement).value;
  return { activeTag: el.tagName, activeHasText: typeof v === 'string' && v.length > 0 };
}

/** Does the server's index.html point at a different JS entry than the one running right now? That is
 * proof a newer build is live, independent of the service worker and of Firestore. Throws on network
 * failure (caller treats as "no signal"). */
export async function deployedEntryDiffers(): Promise<boolean> {
  const running = [...document.querySelectorAll('script[src]')]
    .map((s) => (s as HTMLScriptElement).getAttribute('src') || '')
    .find((src) => /assets\/index-[^/]+\.js/.test(src));
  if (!running) return false;
  const res = await fetch(window.location.pathname + '?v=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) return false;
  const html = await res.text();
  const live = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  const mine = running.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  return !!live && !!mine && live !== mine;
}

/** Last-resort update: unregister the service worker, drop its caches, reload from the network.
 * Sign-in, Firestore data and settings are untouched. */
export async function forceFreshReload(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys?.()) || [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* reload anyway */ }
  window.location.reload();
}
