import { useApp } from '../store/AppContext';
import { nf, thDate, thTime } from '../utils/format';

export default function ReceiveScreen() {
  const {
    state, sub, setRecvNo, setRecvSearch, pickRecvMed, setRecvLot, setRecvExp, setRecvQty,
    addRecv, removeRecvItem, commitReceive, approvePendingReceive, rejectPendingReceive, openScanSearch,
  } = useApp();

  const recvMed = state.recvMed ? state.meds.find((m) => m.id === state.recvMed) : null;
  const options = !state.recvMed && state.recvSearch.trim()
    ? state.meds.filter((m) => m.active && m.name.toLowerCase().indexOf(state.recvSearch.trim().toLowerCase()) >= 0).slice(0, 12)
    : [];
  const canApprove = state.role !== 'tech';
  const pending = state.pendingReceives.filter((r) => r.status === 'pending');
  const myPending = pending.filter((r) => r.requestedByUid === state.myUid);

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      {(canApprove ? pending.length > 0 : myPending.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px', color: 'var(--amber-ink)' }}>
            {canApprove ? `รออนุมัติ (${pending.length})` : `คำขอของคุณที่ยังรออนุมัติ (${myPending.length})`}
          </div>
          <div className="card" style={{ overflow: 'hidden', borderColor: 'var(--amber)' }}>
            {(canApprove ? pending : myPending).map((r) => (
              <div key={r.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{r.name}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--green)', flex: 'none' }}>{nf(r.qty)} {r.unit}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
                  ใบเบิก {r.recvNo} · lot {r.lotNo} · exp {thDate(r.exp)} · ขอโดย {r.requestedBy} เมื่อ {thDate(r.ts)} {thTime(r.ts)}
                </div>
                {canApprove ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => approvePendingReceive(r.id)} style={{ flex: 1, border: 0, background: 'var(--green)', color: '#fff', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}>อนุมัติ</button>
                    <button
                      onClick={() => { const reason = window.prompt('เหตุผลที่ปฏิเสธ (จะบันทึกลง audit log)'); if (reason !== null) rejectPendingReceive(r.id, reason.trim()); }}
                      style={{ flex: 1, border: '1px solid var(--red)', background: '#fff', color: 'var(--red)', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}
                    >
                      ปฏิเสธ
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: 'var(--amber-ink)', marginTop: 6, fontWeight: 600 }}>รอเภสัชกร/แอดมินอนุมัติ</div>
                )}
              </div>
            ))}
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
          <button onClick={() => openScanSearch('receive')} style={{ border: '1px solid var(--border)', background: '#fff', borderRadius: 10, width: 46, minHeight: 44, fontSize: 17, flex: 'none' }}>▣</button>
        </div>

        {options.length > 0 && (
          <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 172, overflowY: 'auto', marginBottom: 9 }}>
            {options.map((m) => (
              <button key={m.id} onClick={() => pickRecvMed(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #f2f3ee', background: '#fff', padding: '10px 12px', minHeight: 44 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{m.name}</span>
                <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>substock {nf(sub(m.id))} · par {nf(m.parSub)}</span>
              </button>
            ))}
          </div>
        )}

        {recvMed && (
          <>
            <div style={{ background: 'var(--green-tint)', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, fontWeight: 600, marginBottom: 9 }}>{recvMed.name}</div>
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
          <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
            {state.recvItems.map((it, i) => (
              <div key={i} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.name}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>lot {it.lotNo} · exp {thDate(it.exp)} · {nf(it.qty)} {it.unit}</div>
                </div>
                <button onClick={() => removeRecvItem(i)} style={{ border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12.5, flex: 'none' }}>ลบ</button>
              </div>
            ))}
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
const inputStyle: CSSProperties = { width: '100%', border: '1px solid var(--border)', background: '#fff', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };
