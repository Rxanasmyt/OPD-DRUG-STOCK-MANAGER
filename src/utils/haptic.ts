// Vibration API — supported on most Android browsers, unsupported on iOS Safari (Apple has
// never shipped it) and on any desktop without a vibration motor. `navigator.vibrate` is
// simply `undefined` there, so every call here is optional-chained and wrapped in try/catch:
// this is pure feel, never something the rest of the app can depend on succeeding.

/** A short, neutral tap — used for a successful commit (เติมหน้างานสำเร็จ, รับเข้าสำเร็จ,
 * บันทึกปรับยอด, ตัด lot หมดอายุ, สแกน QR สำเร็จ) so confirmation registers by feel, not just by
 * reading the toast that follows. */
export function hapticSuccess(): void {
  try { navigator.vibrate?.(15); } catch { /* unsupported — silently do nothing */ }
}

/** A short double-buzz — used wherever toastErr() already surfaces an error, so a real failure
 * (not just "no results") is felt as clearly different from a success, without adding a sound
 * or a more intrusive UI. */
export function hapticError(): void {
  try { navigator.vibrate?.([20, 60, 20]); } catch { /* ignore */ }
}
