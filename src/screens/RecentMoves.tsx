// "เติมหน้างาน / รับเข้าล่าสุดของฉัน" — the caller's own moves from the last 24h, each cancellable (ลงผิดยา/ผิดจำนวน).
// A cancel puts the stock back into the same lots and appends reversal rows (see AppContext.reverseMove).
import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';
import { isReversalReason } from '../utils/returnReasons';
import { cancelledMoveIds, parseReceiveNote, parseTransferNote } from '../utils/moveUndo';

const timeOf = (ts: number) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }) + ' น.';

export default function RecentMoves({ kind }: { kind: 'transfer' | 'receive' }) {
  const { state, userName, reverseMove, myProfile } = useApp();
  const [open, setOpen] = useState(false);
  const me = userName();
  const type = kind === 'transfer' ? 'transfer_to_floor' : 'receive_from_central';
  const label = kind === 'transfer' ? 'เติมหน้างาน' : 'รับเข้า';
  const rows = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600000;
    const cancelled = cancelledMoveIds(state.txs, isReversalReason);
    return state.txs
      .filter((t) => t.type === type && t.ts >= cutoff && (t.by === me || myProfile?.role === 'admin'))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 30)
      .map((t) => ({
        t, cancelled: cancelled.has(t.id),
        readable: kind === 'transfer' ? !!parseTransferNote(t.note, Math.abs(t.qty)) : !!parseReceiveNote(t.note),
      }));
  }, [state.txs, me, myProfile?.role, type, kind]);
  if (rows.length === 0) return null;
  const busy = !!state.busy['moveReverse'];
  return (
    <section className="rt-today card" data-testid={'recent-moves-' + kind} style={{ marginTop: 14 }}>
      <button type="button" className="rt-today-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">🕘</span>
        <span className="rt-today-title"><b>{label}ล่าสุดของฉัน</b><small>{rows.length} รายการใน 24 ชม. — ลงผิดยา/ผิดจำนวน กด “ยกเลิก” ได้ที่นี่</small></span>
        <span className="rt-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="rt-today-body">
          {rows.map(({ t, cancelled, readable }) => (
            <div key={t.id} className="rt-row" data-cancelled={cancelled ? '1' : '0'}>
              <div className="rt-row-main">
                <div className="rt-row-name">{t.name}</div>
                <div className="rt-row-sub">{timeOf(t.ts)} · {label} {nf(Math.abs(t.qty))} {t.unit}{!readable && !cancelled ? ' · รายการเก่า ยกเลิกอัตโนมัติไม่ได้ (ใช้ปรับยอด)' : ''}</div>
              </div>
              {cancelled
                ? <span className="rt-pill rt-pill--off">ยกเลิกแล้ว</span>
                : !readable
                  ? <span className="rt-pill rt-pill--off">ปรับยอด</span>
                  : <button type="button" className="rt-cancel" disabled={busy} onClick={() => void reverseMove(t)} aria-label={'ยกเลิก' + label + ' ' + t.name}>ยกเลิก</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
