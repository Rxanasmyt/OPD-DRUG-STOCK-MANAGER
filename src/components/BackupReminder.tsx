// Admin-only red banner: "การสำรองข้อมูลอัตโนมัติไม่ได้รันมา > 36 ชม." — read from meta/backupStatus (stamped by the daily
// backup workflow after a verified backup). Missing stamp = say nothing (cannot tell "not deployed yet" from "broken").
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import { fetchBackupStatus } from '../store/repositories/metaRepo';

export const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;
const DISMISS_KEY = 'opd-backup-reminder-dismissed';

export default function BackupReminder() {
  const { state } = useApp();
  const [last, setLast] = useState<number | null>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  const isAdmin = state.authStatus === 'signedIn' && state.role === 'admin';
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    fetchBackupStatus().then((s) => { if (alive) setLast(s ? s.lastBackupAt : null); }).catch(() => { /* offline / rules: stay silent */ });
    return () => { alive = false; };
  }, [isAdmin]);
  if (!isAdmin || hidden || last == null || state.screen === 'login') return null;
  const ageH = (Date.now() - last) / 3600000;
  if (ageH * 3600000 <= BACKUP_STALE_MS) return null;
  const days = Math.floor(ageH / 24);
  return (
    <div className="rr-banner" data-level="overdue" role="alert" data-testid="backup-reminder">
      <span className="rr-ico" aria-hidden="true">🛟</span>
      <div className="rr-txt">
        <b>การสำรองข้อมูลอัตโนมัติไม่ได้รันมา {days >= 2 ? days + ' วัน' : Math.round(ageH) + ' ชั่วโมง'}</b>
        <span>ตรวจที่ GitHub → Actions → “Firestore Backup” (อาจถูกปิดอัตโนมัติ/คีย์หมดอายุ) — ถ้าข้อมูลเสียตอนนี้จะกู้ได้เก่ากว่านี้</span>
      </div>
      <button type="button" className="rr-x" aria-label="ซ่อนข้อความนี้ในรอบนี้" onClick={() => { setHidden(true); try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } }}>✕</button>
    </div>
  );
}
