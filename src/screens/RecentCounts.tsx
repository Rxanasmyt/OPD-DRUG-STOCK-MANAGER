// "การนับล่าสุดของฉัน" — the caller's own stock counts from the last 24h, each cancellable (ลงผิดที่/ผิดจำนวน แก้ไขได้ที่นี่).
// A cancel appends a reversal row and puts the quantity back (see AppContext.reverseCount); the original stays in the log.
import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';
import { isReversalReason } from '../utils/returnReasons';

const timeOf = (ts: number) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }) + ' น.';

export default function RecentCounts() {
  const { state, userName, reverseCount, myProfile } = useApp();
  const [open, setOpen] = useState(false);
  const me = userName();
  const rows = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600000;
    const cancelled = new Set<string>();
    for (const t of state.txs) if (t.type === 'count' && isReversalReason(t.reason)) { const m = /^#([A-Za-z0-9]+)/.exec(t.note ?? ''); if (m?.[1]) cancelled.add(m[1]); }
    return state.txs
      .filter((t) => t.type === 'count' && !isReversalReason(t.reason) && t.ts >= cutoff && (t.by === me || myProfile?.role === 'admin'))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 30)
      .map((t) => ({ t, cancelled: cancelled.has(t.id) }));
  }, [state.txs, me, myProfile?.role]);
  if (rows.length === 0) return null;
  const busy = !!state.busy['countReverse'];
  return (
    <section className="rt-today card" data-testid="recent-counts" style={{ marginTop: 14 }}>
      <button type="button" className="rt-today-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">🕘</span>
        <span className="rt-today-title"><b>การนับล่าสุดของฉัน</b><small>{rows.length} รายการใน 24 ชม. — นับผิดที่/ผิดจำนวน กด “ยกเลิก” ได้ที่นี่</small></span>
        <span className="rt-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="rt-today-body">
          {rows.map(({ t, cancelled }) => {
            const sub = t.loc === 'substock';
            const lossy = sub && t.qty < 0;
            return (
              <div key={t.id} className="rt-row" data-cancelled={cancelled ? '1' : '0'}>
                <div className="rt-row-main">
                  <div className="rt-row-name">{t.name}</div>
                  <div className="rt-row-sub">{timeOf(t.ts)} · นับ{sub ? ' substock' : 'หน้างาน'} · ปรับยอด {t.qty > 0 ? '+' : ''}{nf(t.qty)} {t.unit}{lossy ? ' · ตัดจาก lot จริง ยกเลิกอัตโนมัติไม่ได้ (ให้นับใหม่)' : ''}</div>
                </div>
                {cancelled
                  ? <span className="rt-pill rt-pill--off">ยกเลิกแล้ว</span>
                  : t.qty === 0 || lossy
                    ? <span className="rt-pill rt-pill--off">{t.qty === 0 ? 'ตรงระบบ' : 'นับใหม่'}</span>
                    : <button type="button" className="rt-cancel" disabled={busy} onClick={() => void reverseCount(t)} aria-label={'ยกเลิกการนับ ' + t.name}>ยกเลิก</button>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
