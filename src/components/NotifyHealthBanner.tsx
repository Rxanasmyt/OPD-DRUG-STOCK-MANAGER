// Admin-only red banner on the home screen: "ระบบแจ้งเตือน LINE ไม่ได้ทำงาน…" — read from meta/notifyStatus, which every scheduled LINE
// notifier stamps after each run (even a run that had nothing to send). Silent until the first stamp exists (cannot tell "not set up yet"
// from "broken"). The weekday jobs run on public holidays too (cron knows no holidays), so > 4 days without a run really is a problem.
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import { fetchNotifyStatus, type NotifyStatus } from '../store/repositories/metaRepo';

const DAY = 24 * 3600000;
const JOBS = [
  { key: 'stock', label: 'สรุปสต็อกประจำวัน', staleMs: 4 * DAY },
  { key: 'hosxp', label: 'เตือนตัดยอด HOSxP', staleMs: 4 * DAY },
  { key: 'monthly', label: 'รายงานคืนยารายเดือน', staleMs: 40 * DAY },
] as const;
const DISMISS_KEY = 'opd-notify-health-dismissed';

export interface NotifyProblem { label: string; text: string }
/** Pure: which jobs look broken. */
export function notifyProblems(status: NotifyStatus | null, now: number): NotifyProblem[] {
  if (!status) return [];
  const out: NotifyProblem[] = [];
  for (const j of JOBS) {
    const r = status[j.key];
    if (!r) continue;
    if (r.result === 'failed') out.push({ label: j.label, text: 'รอบล่าสุดส่งไม่สำเร็จ' + (r.error ? ' — ' + r.error.slice(0, 80) : '') });
    else if (now - r.ranAt > j.staleMs) out.push({ label: j.label, text: 'ไม่ได้ทำงานมา ' + Math.floor((now - r.ranAt) / DAY) + ' วัน' });
  }
  return out;
}

export default function NotifyHealthBanner() {
  const { state } = useApp();
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  const isAdmin = state.authStatus === 'signedIn' && state.role === 'admin';
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    fetchNotifyStatus().then((s) => { if (alive) setStatus(s); }).catch(() => { /* offline / rules: stay silent */ });
    return () => { alive = false; };
  }, [isAdmin]);
  if (!isAdmin || hidden || state.screen !== 'home') return null;
  const problems = notifyProblems(status, Date.now());
  if (!problems.length) return null;
  return (
    <div className="rr-banner" data-level="overdue" role="alert" data-testid="notify-health-banner">
      <span className="rr-ico" aria-hidden="true">📵</span>
      <div className="rr-txt">
        <b>ระบบแจ้งเตือน LINE มีปัญหา</b>
        <span>{problems.map((p) => p.label + ': ' + p.text).join(' · ')} — ตรวจที่ GitHub → Actions (อาจถูกปิดอัตโนมัติ/คีย์ MOPH หมดอายุ)</span>
      </div>
      <button type="button" className="rr-x" aria-label="ซ่อนข้อความนี้ในรอบนี้" onClick={() => { setHidden(true); try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } }}>✕</button>
    </div>
  );
}
