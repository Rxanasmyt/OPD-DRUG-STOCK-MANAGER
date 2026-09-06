// ยาใกล้หมดอายุ — local notification helper.
//
// This is a static site with no backend (see README/CHANGELOG's own notes on avoiding a paid
// Firebase plan just to run Cloud Functions on a schedule) — there is nothing that can wake a
// closed browser and push a real notification the way a native app or a server-backed PWA
// could. What this CAN do, honestly: check the real lot data for near-expiry/expired stock
// every time someone actually opens the app (or brings the tab back to the foreground), and
// show a real OS-level notification through the already-registered service worker if there's
// something worth flagging — at most once per calendar day, so it never spams. Framed to the
// person as "แจ้งเตือนตอนเปิดแอพ", never as a background push it can't actually deliver.

const ENABLED_KEY = 'opd-expiry-notify-enabled';
const LAST_NOTIFIED_KEY = 'opd-expiry-notify-last-date';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

export function currentPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

export function readNotifyEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}

export function writeNotifyEnabled(v: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0'); } catch { /* private-mode/unavailable — setting just won't stick */ }
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  return Notification.requestPermission();
}

function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Shows a "ยาใกล้หมดอายุ/หมดอายุแล้ว" notification if there's anything to report, the person
 * has opted in AND granted OS permission, and one hasn't already fired today. Silent no-op on
 * every other path (nothing to report, not opted in, permission missing, SW not ready) — this
 * is a nice-to-have layered on top of the real in-app warnings (HomeScreen's ใกล้หมดอายุ
 * section), never something the rest of the app depends on.
 */
export async function maybeNotifyExpiring(nearCount: number, expiredCount: number): Promise<void> {
  if (nearCount <= 0 && expiredCount <= 0) return;
  if (!notificationsSupported() || !readNotifyEnabled() || Notification.permission !== 'granted') return;
  let last = '';
  try { last = localStorage.getItem(LAST_NOTIFIED_KEY) || ''; } catch { /* ignore */ }
  const today = todayKey();
  if (last === today) return;
  try { localStorage.setItem(LAST_NOTIFIED_KEY, today); } catch { /* ignore */ }

  const title = expiredCount > 0 ? '⚠️ มียาหมดอายุแล้ว' : '⏰ มียาใกล้หมดอายุ';
  const parts: string[] = [];
  if (expiredCount > 0) parts.push(expiredCount + ' รายการหมดอายุแล้ว');
  if (nearCount > 0) parts.push(nearCount + ' รายการใกล้หมดอายุ');
  const body = parts.join(' · ') + ' — แตะเพื่อเปิดแอพตรวจสอบ';
  const iconUrl = import.meta.env.BASE_URL + 'icon-192.png';

  try {
    const reg = await navigator.serviceWorker.ready;
    // tag: replacing rather than stacking is correct here — this fires at most once a day, so
    // there's never a legitimate reason to show two of these at once.
    await reg.showNotification(title, { body, icon: iconUrl, badge: iconUrl, tag: 'expiry-warning' });
  } catch {
    // Service worker not available/ready (plain dev server, browser without SW support after
    // all) — a directly-constructed Notification is the documented fallback, though some
    // browsers refuse it outside a SW context; give up quietly either way, never surface an
    // error for this optional feature.
    try { new Notification(title, { body }); } catch { /* ignore */ }
  }
}
