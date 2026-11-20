// "รายการคืนวันนี้" — today's returns grouped by patient (HN), each cancellable. A cancel appends a reversal row and takes
// the qty back off the floor (see AppContext.reverseReturn); the original row stays visible, marked ยกเลิกแล้ว.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';
import { isReversalReason, reversedIds } from '../utils/returnReasons';

const timeOf = (ts: number) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' }) + ' น.';

export default function TodayReturns() {
  const { state, refreshTodayReturns, reverseReturn } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => { void refreshTodayReturns(); }, [refreshTodayReturns]);

  const { groups, totalValue, count } = useMemo(() => {
    const cancelled = reversedIds(state.todayReturns);
    const originals = state.todayReturns.filter((r) => !isReversalReason(r.reason));
    const byHn = new Map<string, typeof originals>();
    for (const r of originals) { const a = byHn.get(r.hn) ?? []; a.push(r); byHn.set(r.hn, a); }
    const live = originals.filter((r) => r.id && !cancelled.has(r.id));
    return {
      groups: Array.from(byHn.entries()).map(([hn, rows]) => ({ hn, rows, cancelled })),
      totalValue: live.reduce((s, r) => s + r.value, 0),
      count: live.length,
    };
  }, [state.todayReturns]);

  if (state.todayReturns.length === 0) return null;
  const busy = !!state.busy['returnReverse'];
  return (
    <section className="rt-today card" data-testid="today-returns">
      <button type="button" className="rt-today-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">🧾</span>
        <span className="rt-today-title"><b>รายการคืนวันนี้</b><small>{nf(count)} รายการ · {nf(Math.round(totalValue))} บาท — ลงผิดกด “ยกเลิก” ได้ที่นี่</small></span>
        <span className="rt-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="rt-today-body">
          {groups.map(({ hn, rows, cancelled }) => (
            <div key={hn} className="rt-hn">
              <div className="rt-hn-h">👤 HN {hn}</div>
              {rows.map((r) => {
                const isCancelled = !!r.id && cancelled.has(r.id);
                return (
                  <div key={r.id ?? r.ts} className="rt-row" data-cancelled={isCancelled ? '1' : '0'}>
                    <div className="rt-row-main">
                      <div className="rt-row-name">{r.medName}</div>
                      <div className="rt-row-sub">{timeOf(r.ts)} · {nf(r.qty)} {r.unit} · {r.reason}</div>
                    </div>
                    {isCancelled
                      ? <span className="rt-pill rt-pill--off">ยกเลิกแล้ว</span>
                      : <button type="button" className="rt-cancel" disabled={busy || !r.id} onClick={() => void reverseReturn(r)} aria-label={'ยกเลิกรายการคืน ' + r.medName}>ยกเลิก</button>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
