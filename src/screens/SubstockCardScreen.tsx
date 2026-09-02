import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { subQty } from '../store/selectors';
import { nf, thDate, thTime } from '../utils/format';

const inputStyle = { width: '100%', border: '1px solid var(--border)', background: '#fff', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };

const TYPE_LABEL: Record<string, string> = {
  receive_from_central: 'รับจากคลังใหญ่',
  transfer_to_floor: 'เติมหน้างาน',
  expired: 'ตัดหมดอายุ',
};

interface LedgerRow { ts: number; type: string; qty: number; note: string; by: string; balance: number }

/** The digital replacement for the paper "ใบเบิกยาจากคลัง-จ่ายเข้าชั้นวางยา" ledger — pick a
 * med, see its substock รับ-จ่าย-คงเหลือ in real time instead of a physical card someone
 * updates by hand and can misplace, smudge, or forget to bring. */
export default function SubstockCardScreen() {
  const { state, fetchSubstockLedger } = useApp();
  const [search, setSearch] = useState('');
  const [medId, setMedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);

  const med = medId ? state.meds.find((m) => m.id === medId) : null;
  const options = !medId && search.trim()
    ? state.meds.filter((m) => m.active && m.name.toLowerCase().indexOf(search.trim().toLowerCase()) >= 0).slice(0, 10)
    : [];

  const openCard = async (id: string) => {
    const m = state.meds.find((x) => x.id === id);
    if (!m) return;
    setMedId(id);
    setSearch(m.name);
    setLoading(true);
    setRows(null);
    try {
      const ledger = await fetchSubstockLedger(id);
      setRows(ledger);
    } finally {
      setLoading(false);
    }
  };

  const liveBalance = med ? subQty(state, med.id) : 0;
  const lastLedgerBalance = rows && rows.length ? rows[rows.length - 1].balance : 0;
  // The live balance (from current lots) and the ledger's computed running total should
  // always agree — if they don't, something in the tx history is incomplete or a lot was
  // touched outside the normal receive/transfer/scrap paths. Surface the mismatch rather
  // than silently showing two different numbers.
  const mismatch = rows && rows.length > 0 && liveBalance !== lastLedgerBalance;

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        เลือกยาเพื่อดูบัตรสต็อก substock แบบ real-time — รับจากคลังใหญ่ / เติมหน้างาน / ตัดหมดอายุ พร้อมยอดคงเหลือสะสม แทนบัตรกระดาษที่ต้องจดมือ
      </div>

      {!medId && (
        <>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อยา" style={inputStyle} />
          {options.length > 0 && (
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 280, overflowY: 'auto', marginTop: 9 }}>
              {options.map((m) => (
                <button key={m.id} onClick={() => openCard(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #f2f3ee', background: '#fff', padding: '10px 12px', minHeight: 44 }}>
                  <span style={{ fontSize: 13.5 }}>{m.name}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>substock ปัจจุบัน {nf(subQty(state, m.id))} {m.unit}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {med && (
        <>
          <div className="card" style={{ padding: 13, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{med.name}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{med.code} · par substock {nf(med.parSub)} {med.unit}</div>
              </div>
              <button onClick={() => { setMedId(null); setSearch(''); setRows(null); }} style={{ flex: 'none', border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)', padding: '7px 12px', borderRadius: 9, fontSize: 12 }}>เปลี่ยนยา</button>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1, background: 'var(--green-tint)', borderRadius: 10, padding: '10px 12px' }}>
                <div className="muted" style={{ fontSize: 11 }}>substock คงเหลือตอนนี้</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>{nf(liveBalance)} <span style={{ fontSize: 12, fontWeight: 500 }}>{med.unit}</span></div>
              </div>
            </div>
            {mismatch && (
              <div style={{ fontSize: 11, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 8, padding: '7px 10px', marginTop: 9, lineHeight: 1.5 }}>
                ยอดจากประวัติธุรกรรม ({nf(lastLedgerBalance)} {med.unit}) ไม่ตรงกับยอดจริงตอนนี้ — อาจมีการปรับยอดนอกช่องทางปกติ ลองตรวจสอบใน Audit log
              </div>
            )}
          </div>

          {loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)', fontSize: 13 }}>กำลังโหลดประวัติ…</div>}

          {rows && !loading && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', padding: '9px 13px', background: '#f2f3ee', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                <span style={{ flex: 1 }}>รายการ</span>
                <span style={{ width: 60, textAlign: 'right', flex: 'none' }}>รับ/จ่าย</span>
                <span style={{ width: 62, textAlign: 'right', flex: 'none' }}>คงเหลือ</span>
              </div>
              {rows.slice().reverse().map((r, i) => (
                <div key={i} style={{ display: 'flex', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{TYPE_LABEL[r.type] || r.type}</div>
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>{thDate(r.ts)} {thTime(r.ts)} · {r.by}</div>
                    {r.note && <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>{r.note}</div>}
                  </div>
                  <span style={{ width: 60, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 700, color: r.qty < 0 ? 'var(--red)' : 'var(--green)' }}>{(r.qty > 0 ? '+' : '') + nf(r.qty)}</span>
                  <span style={{ width: 62, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600 }}>{nf(r.balance)}</span>
                </div>
              ))}
              {rows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยานี้ยังไม่มีประวัติ substock</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
