// ยาใกล้หมดอายุ / ยาต่ำกว่า Min — local notification helpers.
//
// This is a static site with no backend (see README/CHANGELOG's own notes on avoiding a paid
// Firebase plan just to run Cloud Functions on a schedule) — there is nothing that can wake a
// closed browser and push a real notification the way a native app or a server-backed PWA
// could. What this CAN do, honestly: check the real data every time someone actually opens the
// app (or brings the tab back to the foreground), and show a real OS-level notification through
// the already-registered service worker if there's something worth flagging — at most once per
// calendar day per topic, so it never spams. Framed to the person as "แจ้งเตือนตอนเปิดแอพ", never
// as a background push it can't actually deliver.

const EXPIRY_ENABLED_KEY = 'opd-expiry-notify-enabled';
const EXPIRY_LAST_NOTIFIED_KEY = 'opd-expiry-notify-last-date';
// Separate opt-in/throttle from expiry — a pharmacist might want one without the other, and a
// day can legitimately have both an expiry issue AND a low-stock issue worth two notifications.
const LOW_STOCK_ENABLED_KEY = 'opd-lowstock-notify-enabled';
const LOW_STOCK_LAST_NOTIFIED_KEY = 'opd-lowstock-notify-last-date';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

export function currentPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

export function readNotifyEnabled(): boolean {
  try { return localStorage.getItem(EXPIRY_ENABLED_KEY) === '1'; } catch { return false; }
}

export function writeNotifyEnabled(v: boolean): void {
  try { localStorage.setItem(EXPIRY_ENABLED_KEY, v ? '1' : '0'); } catch { /* private-mode/unavailable — setting just won't stick */ }
}

export function readLowStockNotifyEnabled(): boolean {
  try { return localStorage.getItem(LOW_STOCK_ENABLED_KEY) === '1'; } catch { return false; }
}

export function writeLowStockNotifyEnabled(v: boolean): void {
  try { localStorage.setItem(LOW_STOCK_ENABLED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  return Notification.requestPermission();
}

function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** True (and marks today as used) only the first time this is called for `key` on a given
 * calendar day — shared once-a-day throttle for both notification topics below, so each keeps
 * its own independent "already fired today" state under its own storage key. */
function claimOnceToday(lastNotifiedKey: string): boolean {
  let last = '';
  try { last = localStorage.getItem(lastNotifiedKey) || ''; } catch { /* ignore */ }
  const today = todayKey();
  if (last === today) return false;
  try { localStorage.setItem(lastNotifiedKey, today); } catch { /* ignore */ }
  return true;
}

async function sendNotification(title: string, body: string, tag: string): Promise<void> {
  const iconUrl = import.meta.env.BASE_URL + 'icon-192.png';
  try {
    const reg = await navigator.serviceWorker.ready;
    // tag: replacing rather than stacking is correct here — each topic fires at most once a
    // day, so there's never a legitimate reason to show two of the SAME topic at once (a
    // different topic uses its own tag, so the two can coexist instead of one replacing the
    // other).
    await reg.showNotification(title, { body, icon: iconUrl, badge: iconUrl, tag });
  } catch {
    // Service worker not available/ready (plain dev server, browser without SW support after
    // all) — a directly-constructed Notification is the documented fallback, though some
    // browsers refuse it outside a SW context; give up quietly either way, never surface an
    // error for this optional feature.
    try { new Notification(title, { body }); } catch { /* ignore */ }
  }
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
  if (!claimOnceToday(EXPIRY_LAST_NOTIFIED_KEY)) return;

  const title = expiredCount > 0 ? '⚠️ มียาหมดอายุแล้ว' : '⏰ มียาใกล้หมดอายุ';
  const parts: string[] = [];
  if (expiredCount > 0) parts.push(expiredCount + ' รายการหมดอายุแล้ว');
  if (nearCount > 0) parts.push(nearCount + ' รายการใกล้หมดอายุ');
  const body = parts.join(' · ') + ' — แตะเพื่อเปิดแอพตรวจสอบ';
  await sendNotification(title, body, 'expiry-warning');
}

/**
 * Shows a "ยาต่ำกว่า Min — ควรเติมหน้างานวันนี้" notification, same opt-in/permission/once-a-day
 * shape as maybeNotifyExpiring() above (see its doc comment) — a separate topic (own storage
 * keys, own notification tag) so it can be turned on/off independently and never collides with
 * or replaces an expiry notification the same day. `urgentCount` (already at/below half of Min
 * — see isUrgentLow(), selectors.ts) is called out on its own in the body when nonzero, since
 * that's the subset that can't wait for a slower day.
 */
export async function maybeNotifyLowStock(belowMinCount: number, urgentCount: number): Promise<void> {
  if (belowMinCount <= 0) return;
  if (!notificationsSupported() || !readLowStockNotifyEnabled() || Notification.permission !== 'granted') return;
  if (!claimOnceToday(LOW_STOCK_LAST_NOTIFIED_KEY)) return;

  const title = urgentCount > 0 ? '🔴 มียาเร่งด่วนต้องเติมหน้างาน' : '📦 มียาต่ำกว่า Min';
  const parts: string[] = [belowMinCount + ' รายการต่ำกว่า Min'];
  if (urgentCount > 0) parts.push(urgentCount + ' รายการเร่งด่วน (ต่ำกว่าครึ่งหนึ่งของ Min)');
  const body = parts.join(' · ') + ' — แตะเพื่อเปิดแอพเติมหน้างาน';
  await sendNotification(title, body, 'low-stock-warning');
}
