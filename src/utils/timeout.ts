/**
 * A `runTransaction` (or any network write) can hang indefinitely when the browser reports
 * "online" but can't actually reach Firestore — a hospital wifi captive portal, a flaky
 * access point, a firewall silently dropping the connection. The SDK keeps retrying inside
 * that call with no built-in ceiling, so without this a "กำลังบันทึก" action would just spin
 * forever with no way for the person at the counter to know whether it worked, whether to
 * wait, or whether to walk away and try again on another device. Race it against a timer
 * instead, so a stuck write fails fast with a clear message rather than hanging silently.
 */
export class TimeoutError extends Error {
  constructor() {
    super('การเชื่อมต่อช้าเกินไปหรือขาดหาย — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (รายการนี้อาจยังไม่ถูกบันทึก ตรวจสอบก่อนทำซ้ำ)');
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms = 15000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (v) => { window.clearTimeout(t); resolve(v); },
      (e) => { window.clearTimeout(t); reject(e); },
    );
  });
}
