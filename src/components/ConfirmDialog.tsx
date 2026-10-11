import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';

/** In-app replacement for window.confirm() — rendered once, globally, in App.tsx. See
 * confirmAsync()/respondConfirm() in AppContext.tsx and confirmDialog's doc comment in
 * types.ts for why this exists: the native browser confirm() can silently no-op inside some
 * embedded WebView/PWA contexts, which reads to the person tapping a button as "nothing
 * happened" with no error anywhere to diagnose. A real rendered dialog can't do that — if this
 * component is on screen, the person sees it.
 *
 * Same "closes gracefully, not just vanishes" fix Toast.tsx got — this used to hard-cut the
 * instant respondConfirm() ran, so even the button you just tapped disappeared mid-frame
 * instead of visibly responding to the tap. Keeps rendering one more beat with an exit
 * animation instead. */
export default function ConfirmDialog() {
  const { state, respondConfirm } = useApp();
  const [shown, setShown] = useState<{ message: string; exiting: boolean } | null>(null);
  const exitTimer = useRef<number>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Bug fix (audit finding — accessibility): same focus-restore BottomSheet.tsx already has —
  // whoever tapped/keyboard-activated the button that opened this dialog had focus silently
  // dropped to <body> on close, so a keyboard/switch-device user had to restart tabbing from the
  // top of the page instead of picking up where they left off. This dialog guards the app's most
  // consequential actions (ยืนยันลบถาวร, ปิดใช้งานบัญชี, ...), so the gap mattered more here than
  // on a cosmetic surface.
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    window.clearTimeout(exitTimer.current);
    if (state.confirmDialog) {
      triggerRef.current = document.activeElement;
      setShown({ message: state.confirmDialog.message, exiting: false });
    } else {
      setShown((s) => (s ? { ...s, exiting: true } : s));
      exitTimer.current = window.setTimeout(() => setShown(null), 180);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
      triggerRef.current = null;
    }
    return () => window.clearTimeout(exitTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.confirmDialog]);

  // Bug fix (audit finding — accessibility): moves focus onto "ยกเลิก" (the safe default
  // action) once the dialog is actually in the DOM — without this, focus stayed on the trigger
  // button behind the now-visible dialog, so the next Tab press from a keyboard/switch device
  // landed on whatever was next in the SCREEN behind it, not in the dialog in front of it.
  // Deliberately depends on `shown.exiting` (the LOCAL state that actually gates whether the
  // dialog's own DOM/cancelRef exists), not `state.confirmDialog` — that object flips truthy one
  // render BEFORE `setShown` above has run, so an effect keyed off it fires while `shown` (and
  // therefore cancelRef.current) is still null, silently doing nothing.
  useEffect(() => {
    if (shown && !shown.exiting) cancelRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.exiting]);

  // Same reasoning as PromptDialog.tsx — backdrop tap and ยกเลิก already cancel; Escape from a
  // physical keyboard or accessibility switch device had no way to do the same.
  //
  // Bug fix (audit finding — accessibility, focus trap): same gap BottomSheet.tsx already
  // closed — Tab/Shift+Tab used to walk straight out of this dialog into the (supposedly inert)
  // screen behind it, since nothing here constrained focus to the dialog's own two buttons.
  useEffect(() => {
    if (!state.confirmDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { respondConfirm(false); return; }
      if (e.key !== 'Tab' || !cardRef.current) return;
      const focusable = cardRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.confirmDialog, respondConfirm]);

  if (!shown) return null;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        animation: shown.exiting ? 'backdropOut .18s var(--ease) both' : 'backdropIn .18s var(--ease-out)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) respondConfirm(false); }}
    >
      <div
        ref={cardRef}
        className="card"
        role="alertdialog"
        aria-modal="true"
        aria-describedby="confirm-dialog-message"
        style={{ width: '100%', maxWidth: 380, padding: 18, animation: shown.exiting ? 'popOut .18s var(--ease) both' : 'pop .2s var(--ease-out) both' }}
      >
        <div id="confirm-dialog-message" style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 18 }}>
          {shown.message}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            ref={cancelRef}
            onClick={() => respondConfirm(false)}
            className="btn-outline"
            style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46 }}
          >
            ยกเลิก
          </button>
          <button
            onClick={() => respondConfirm(true)}
            className="btn-primary"
            style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46 }}
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
}
