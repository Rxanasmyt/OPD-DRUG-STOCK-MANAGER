import { useApp } from '../store/AppContext';
import { nf, thTime } from '../utils/format';

export default function TConfirmScreen() {
  const { state, removeFromCart, startHadScan, commitTransfer, userName, roleLabel } = useApp();
  const cartIds = Object.keys(state.cart);
  const meds = state.meds;
  const hadPending = cartIds.filter((id) => meds.find((m) => m.id === id)?.had && !state.hadOk[id]);
  const cartHasHad = cartIds.some((id) => meds.find((m) => m.id === id)?.had);

  const rows = cartIds.map((id) => {
    const m = meds.find((x) => x.id === id)!;
    let need = state.cart[id];
    const used = state.lots
      .filter((l) => l.medId === id && l.qty > 0)
      .sort((a, b) => a.exp - b.exp)
      .map((l) => {
        const take = Math.min(need, l.qty);
        need -= take;
        return take > 0 ? `lot ${l.lotNo} exp ${new Date(l.exp).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })} × ${nf(take)}` : null;
      })
      .filter(Boolean);
    return { id, m, used, qty: state.cart[id] };
  });

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>ตัดจาก substock ตามหลัก FEFO (lot ที่หมดอายุก่อนถูกเลือกให้อัตโนมัติ) และเพิ่มเข้าหน้างาน</div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        {rows.map(({ id, m, used, qty }) => (
          <div key={id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>
                {m.name}
                {m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}> HAD</span>}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{used.join('  ·  ')}</div>
              {m.had && (
                <div style={{ fontSize: 11.5, marginTop: 2, fontWeight: 600, color: state.hadOk[id] ? 'var(--green)' : 'var(--had)' }}>
                  {state.hadOk[id] ? '✓ ยืนยัน QR แล้ว' : 'ต้องสแกน QR ก่อนยืนยัน'}
                </div>
              )}
            </div>
            <div style={{ flex: 'none', textAlign: 'right' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{nf(qty)} {m.unit}</div>
              <button onClick={() => removeFromCart(id)} style={{ border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12, padding: '2px 0' }}>ลบ</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
        ผู้ทำรายการ <b>{userName()}</b> ({roleLabel()})<br />ปลายทาง ชั้นจ่ายยา OPD · เวลา {thTime(Date.now())} น.
      </div>

      {cartHasHad && (
        <button onClick={() => startHadScan(hadPending[0])} style={{ width: '100%', border: 0, background: 'var(--had)', color: '#fff', padding: 16, borderRadius: 12, fontSize: 16, fontWeight: 600, minHeight: 54, marginBottom: 9 }}>
          สแกน QR ยา high alert ({hadPending.length} รายการ)
        </button>
      )}
      {cartIds.length > 0 && hadPending.length === 0 && (
        <button onClick={commitTransfer} className="btn-primary" style={{ width: '100%', padding: 16, borderRadius: 12, fontSize: 16, minHeight: 54 }}>ยืนยันการเติมหน้างาน</button>
      )}
    </div>
  );
}
