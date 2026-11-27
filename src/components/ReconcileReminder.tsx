// "ยังไม่ได้แนบไฟล์ HOSxP" — a banner under the header on every working screen when the daily file has not been attached,
// so a forgotten day is noticed when the app is opened (not days later as silent drift in the floor numbers).
// 'due' (1 working day, from 08:00) is amber; 'overdue' (2+ working days) is red. Dismiss hides it for this session only.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { effectiveLastCoveredTo, reconcileReminder } from '../store/selectors';
import { thDate } from '../utils/format';

const DISMISS_KEY = 'opd-reconcile-reminder-dismissed';

export default function ReconcileReminder() {
  const { state, go } = useApp();
  const [now, setNow] = useState(() => Date.now());
  const [dismissedFor, setDismissedFor] = useState<string | null>(() => { try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; } });
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 10 * 60 * 1000); return () => window.clearInterval(t); }, []);

  const lastCovered = useMemo(() => effectiveLastCoveredTo(state.txs, state.lastReconcileFetched), [state.txs, state.lastReconcileFetched]);
  const r = useMemo(() => reconcileReminder(lastCovered, now), [lastCovered, now]);

  if (r.level === 'ok' || state.screen === 'reconcile' || state.screen === 'login' || state.authStatus !== 'signedIn') return null;
  const key = r.level + '|' + r.lastMissingIso;
  if (dismissedFor === key) return null;
  const toTs = (iso: string | null) => (iso ? new Date(iso + 'T12:00:00+07:00').getTime() : 0);
  const range = r.missingWeekdays === 1 ? thDate(toTs(r.lastMissingIso)) : thDate(toTs(r.firstMissingIso)) + ' – ' + thDate(toTs(r.lastMissingIso));
  const overdue = r.level === 'overdue';
  return (
    <div className="rr-banner" data-level={r.level} role="alert" data-testid="reconcile-reminder">
      <span className="rr-ico" aria-hidden="true">{overdue ? '🚨' : '⏰'}</span>
      <div className="rr-txt">
        <b>{overdue ? 'ยังไม่ได้ตัดยอด HOSxP ' + r.missingWeekdays + ' วันทำการ' : 'ยังไม่ได้แนบไฟล์ HOSxP ของเมื่อวาน'}</b>
        <span>{range} — ถ้าไม่ตัดยอด ตัวเลขหน้างานจะค่อยๆ เพี้ยนจากของจริง</span>
      </div>
      <button type="button" className="rr-go" onClick={() => go('reconcile')}>ตัดยอดเลย ›</button>
      <button type="button" className="rr-x" aria-label="ซ่อนข้อความนี้ในรอบนี้" onClick={() => { setDismissedFor(key); try { sessionStorage.setItem(DISMISS_KEY, key); } catch { /* private mode: just hide for now */ } }}>✕</button>
    </div>
  );
}
