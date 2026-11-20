// Sets --app-h (px) = the real height the app shell should fill.
// iPhone home-screen (standalone) PWAs report a 100dvh a few dozen px shorter than the physical screen, which left an empty band
// under the floating bottom nav. In that one situation (standalone + phone + a small plausible gap) we use screen.height instead.
// Everywhere else this is simply window.innerHeight, i.e. identical to 100dvh. The shell keeps its own CSS fallback (100dvh).
export function computeAppHeight(innerH: number, screenH: number, standalone: boolean, isPhoneWidth: boolean): number {
  const gap = screenH - innerH;
  if (standalone && isPhoneWidth && gap > 0 && gap <= 140) return screenH;
  return innerH;
}

export function syncAppHeight(): void {
  try {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    const portraitScreenH = Math.max(window.screen.height, window.screen.width); // portrait height regardless of how screen reports it
    const isPortrait = window.innerHeight >= window.innerWidth;
    const screenH = isPortrait ? portraitScreenH : Math.min(window.screen.height, window.screen.width);
    const h = computeAppHeight(window.innerHeight, screenH, standalone, window.innerWidth < 560);
    document.documentElement.style.setProperty('--app-h', h + 'px');
  } catch { /* keep the CSS fallback */ }
}

export function startAppHeightSync(): void {
  syncAppHeight();
  window.addEventListener('resize', syncAppHeight);
  window.addEventListener('orientationchange', () => window.setTimeout(syncAppHeight, 250));
  window.addEventListener('pageshow', syncAppHeight);
}
