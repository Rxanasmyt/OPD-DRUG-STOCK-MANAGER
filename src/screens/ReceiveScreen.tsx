import { useApp } from '../store/AppContext';
import { usesSubstock } from '../store/selectors';
import { nf, thDate, thTime } from '../utils/format';
import { MedDot } from '../components/MedDot';
import { Qty } from '../components/Qty';
import { WardBadge } from '../components/WardBadge';

// Same severity bands as toneFor(), applied to substock/par instead of floor/parFloor —
// this screen is about substock, so that's the ratio a pharmacist actually cares about here.
function subTone(cur: number, par: number): string {
  const r = cur / Math.max(1, par);
  return r < 0.34 ? 'var(--red)' : r < 0.75 ? 'var(--amber)' : 'var(--green)';
}

export default function ReceiveScreen() {
  const {
    state, sub, setRecvNo, setRecvSearch, pickRecvMed, setRecvLot, setRecvExp, setRecvQty,
    addRecv, removeRecvItem, commitReceive, approvePendingReceive, rejectPendingReceive, openScanSearch,
    printWarehouseRequestList, promptAsync,
  } = useApp();

  const recvMed = state.recvMed ? state.meds.find((m) => m.id === state.recvMed) : null;
  // OPD/IPD ward tabs removed — one combined picker across the whole formulary.
  const options = !state.recvMed && state.recvSearch.trim()
    ? state.meds.filter((m) => m.active && m.name.toLowerCase().indexOf(state.recvSearch.trim().toLowerCase()) >= 0).slice(0, 12)
    : [];
  // Bug fix: this screen used to show NOTHING until someone typed a search — a person opening
  // "รับเข้า" to see what actually needs requisitioning from the central warehouse had no way
  // to find out except typing each drug's name from memory one at a time. Same "ควรเบิกจากคลัง
  // ใหญ่" list HomeScreen already computes (substock below its par), shown here by default —
  // most urgent (lowest substock/par ratio) first — and it steps aside the moment a search is
  // typed or a med is picked, so it never competes with the actual search results above.
  const needsReceive = !state.recvMed && !state.recvSearch.trim()
    ? state.meds
        .filter((m) => m.active && usesSubstock(m) && sub(m.id) < m.parSub)
        .sort((a, b) => sub(a.id) / Math.max(1, a.parSub) - sub(b.id) / Math.max(1, b.parSub))
        .slice(0, 20)
    : [];
  const canApprove = state.role !== 'tech';
  const pending = state.pendingReceives.filter((r) => r.status === 'pending');
  const myPending = pending.filter((r) => r.requestedByUid === state.myUid);

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <button
        onClick={printWarehouseRequestList}
        className="btn-outline"
        style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13.5, fontWeight: 600, minHeight: 46, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        🖨 พิมพ์ใบขอเบิกจากคลังใหญ่ — รอบ 2 สัปดาห์
      </button>

      {(canApprove ? pending.length > 0 : myPending.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px', color: 'var(--amber-ink)' }}>
            {canApprove ? `รออนุมัติ (${pending.length})` : `คำขอของคุณที่ยังรออนุมัติ (${myPending.length})`}
          </div>
          <div className="card stagger" style={{ overflow: 'hidden', borderColor: 'var(--amber)' }}>
            {(canApprove ? pending : myPending).map((r) => {
              const rMed = state.meds.find((m) => m.id === r.medId);
              return (
              <div key={r.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>{r.name} {rMed && <WardBadge med={rMed} />}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--green)', flex: 'none' }}>{nf(r.qty)} {r.unit}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
                  ใบเบิก {r.recvNo} · lot {r.lotNo} · exp {thDate(r.exp)} · ขอโดย {r.requestedBy} เมื่อ {thDate(r.ts)} {thTime(r.ts)}
                </div>
                {canApprove ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => approvePendingReceive(r.id)} style={{ flex: 1, border: 0, background: 'var(--green)', color: '#fff', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}>อนุมัติ</button>
                    <button
                      onClick={async () => { const reason = await promptAsync('เหตุผลที่ปฏิเสธ (จะบันทึกลง audit log)'); if (reason !== null) rejectPendingReceive(r.id, reason.trim()); }}
                      style={{ flex: 1, border: '1px solid var(--red)', background: 'var(--bg-card)', color: 'var(--red)', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}
                    >
                      ปฏิเสธ
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--amber-ink)', marginTop: 6, fontWeight: 600 }}>รอเภสัชกร/แอดมินอนุมัติ</div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>เลขที่ใบเบิก</span>
          <input value={state.recvNo} onChange={(e) => setRecvNo(e.target.value)} style={inputStyle} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>วันที่รับ</span>
          <input value={new Date().toISOString().slice(0, 10)} type="date" readOnly style={inputStyle} />
        </label>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>เพิ่มรายการ</div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 9 }}>สแกน QR ที่ติดหน้ายาใน substock เพื่อระบุตัวยาอัตโนมัติ หรือค้นหาด้วยชื่อ</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={state.recvSearch} onChange={(e) => setRecvSearch(e.target.value)} placeholder="ค้นหา / สแกนชื่อยา" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
          <button onClick={() => openScanSearch('receive')} title="สแกน QR รับเข้า substock" style={{ border: '1px solid var(--amber)', background: 'var(--amber-bg)', color: 'var(--amber-ink)', borderRadius: 10, width: 46, minHeight: 44, fontSize: 17, flex: 'none' }}>▣</button>
        </div>

        {options.length > 0 && (
          <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 172, overflowY: 'auto', marginBottom: 9 }}>
            {options.map((m) => (
              <button key={m.id} onClick={() => pickRecvMed(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 12px', minHeight: 44 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={m.code} /> {m.name} <WardBadge med={m} /></span>
                <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>substock <Qty value={sub(m.id)} tone={subTone(sub(m.id), m.parSub)} size={11.5} /> · par {nf(m.parSub)}</span>
              </button>
            ))}
          </div>
        )}

        {needsReceive.length > 0 && (
          <div style={{ marginBottom: 9 }}>
            <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, margin: '2px 2px 6px' }}>ควรเบิกจากคลังใหญ่ ({needsReceive.length})</div>
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 260, overflowY: 'auto' }}>
              {needsReceive.map((m) => (
                <button key={m.id} onClick={() => pickRecvMed(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 12px', minHeight: 44 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={m.code} /> {m.name} <WardBadge med={m} /></span>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>substock <Qty value={sub(m.id)} tone={subTone(sub(m.id), m.parSub)} size={11.5} /> · par {nf(m.parSub)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {recvMed && (
          <>
            <div style={{ background: 'var(--green-tint)', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, fontWeight: 600, marginBottom: 9 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={recvMed.code} /> {recvMed.name} <WardBadge med={recvMed} size="md" /></span>
              {!usesSubstock(recvMed) && (
                <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--amber-ink)', marginTop: 3 }}>ไม่มี substock — รับเข้าแล้วขึ้นหน้างานทันที ไม่ต้องเติมอีกขั้น</span>
              )}
            </div>
            <div className="grid-2" style={{ marginBottom: 9 }}>
              <label>
                <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Lot no.</span>
                <input value={state.recvLot} onChange={(e) => setRecvLot(e.target.value)} placeholder="เช่น A2609" style={inputStyle} />
              </label>
              <label>
                <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>วันหมดอายุ</span>
                <input value={state.recvExp} onChange={(e) => setRecvExp(e.target.value)} type="date" style={inputStyle} />
              </label>
            </div>
            <label style={{ display: 'block', marginBottom: 10 }}>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>จำนวนที่รับ ({recvMed.unit})</span>
              <input value={state.recvQty} onChange={(e) => setRecvQty(e.target.value)} inputMode="numeric" style={{ ...inputStyle, fontSize: 16, fontWeight: 600 }} />
            </label>
            <button onClick={addRecv} className="btn-outline" style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 14.5, fontWeight: 600, minHeight: 46 }}>เพิ่มลงใบรับ</button>
          </>
        )}
      </div>

      {state.recvItems.length > 0 && (
        <>
          <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 12 }}>
            {state.recvItems.map((it, i) => {
              const itMed = state.meds.find((m) => m.id === it.medId);
              return (
                <div key={i} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>{it.name} {itMed && <WardBadge med={itMed} />}</div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>lot {it.lotNo} · exp {thDate(it.exp)} · {nf(it.qty)} {it.unit}</div>
                  </div>
                  <button onClick={() => removeRecvItem(i)} style={{ border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12.5, flex: 'none' }}>ลบ</button>
                </div>
              );
            })}
          </div>
          {canApprove ? (
            <button onClick={commitReceive} className="btn-primary" style={{ width: '100%', padding: 16, borderRadius: 12, fontSize: 16, minHeight: 54 }}>อนุมัติรับเข้า substock</button>
          ) : (
            <>
              <button onClick={commitReceive} style={{ width: '100%', border: '1px solid var(--amber)', background: 'var(--amber-bg)', color: 'var(--amber-ink)', padding: 16, borderRadius: 12, fontSize: 15.5, fontWeight: 600, minHeight: 54 }}>ส่งให้เภสัชกรอนุมัติ</button>
              <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 7 }}>สิทธิ์ผู้ช่วยเภสัชกรบันทึกใบรับได้ แต่ยอดจะเข้าสต็อกเมื่อเภสัชกรอนุมัติ</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

import type { CSSProperties } from 'react';
const inputStyle: CSSProperties = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };
