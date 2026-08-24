import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';

export default function ReconcileScreen() {
  const { state, setHosxpText, loadHosxpSample, processHosxp, commitReconcile } = useApp();

  const reconcileRows = (state.hosxpRows || []).map((r) => {
    const m = state.meds.find((x) => x.name.toLowerCase().indexOf(r.name.toLowerCase()) >= 0 || r.name.toLowerCase().indexOf(x.name.toLowerCase()) >= 0);
    const before = m ? m.floor : 0;
    const after = m ? Math.max(0, before - r.qty) : 0;
    return { name: m ? m.name : r.name + ' (ไม่พบในระบบ)', qty: r.qty, before, after };
  });

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        วิธีหลักในการตัดยอดหน้างาน — ใช้เป็นประจำทุกวัน เร็วกว่าการนับสต็อกจริง วางไฟล์ CSV ที่ IT export จาก HOSxP (ชื่อยา, จำนวนจ่าย) ระบบจะตัดยอดหน้างานให้ตรงกับที่จ่ายจริงโดยตรง
      </div>
      <textarea
        value={state.hosxpText}
        onChange={(e) => setHosxpText(e.target.value)}
        placeholder={'เช่น PARACETAMOL 500 mg,340\namlodipine 5 mg,120'}
        style={{ width: '100%', minHeight: 96, border: '1px solid var(--border)', background: '#fff', borderRadius: 10, padding: '11px 12px', fontSize: 13, fontFamily: 'ui-monospace, monospace', resize: 'vertical', marginBottom: 10 }}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={loadHosxpSample} style={{ flex: 1, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)', padding: 11, borderRadius: 10, fontSize: 13, fontWeight: 600, minHeight: 44 }}>จำลองไฟล์ตัวอย่าง</button>
        <button onClick={processHosxp} className="btn-primary" style={{ flex: 1, padding: 11, borderRadius: 10, fontSize: 13, minHeight: 44 }}>ประมวลผล</button>
      </div>

      {reconcileRows.length > 0 && (
        <>
          <div className="card" style={{ overflow: 'hidden', marginBottom: 13 }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: '#f2f3ee', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>รายการยา</span><span style={{ width: 70, textAlign: 'right', flex: 'none' }}>จ่ายจริง</span><span style={{ width: 70, textAlign: 'right', flex: 'none' }}>ก่อน → หลัง</span>
            </div>
            {reconcileRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3 }}>{r.name}</span>
                <span style={{ width: 70, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>−{nf(r.qty)}</span>
                <span className="muted" style={{ width: 70, textAlign: 'right', flex: 'none', fontSize: 12.5 }}>{nf(r.before)}→{nf(r.after)}</span>
              </div>
            ))}
          </div>
          <button onClick={commitReconcile} className="btn-primary" style={{ width: '100%', padding: 15, borderRadius: 12, fontSize: 15, minHeight: 52 }}>ตัดยอดหน้างานตามไฟล์นี้ และบันทึก discrepancy log</button>
        </>
      )}
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 12 }}>ระบบจริง: Cloud Function ดึงยอดจ่าย OPD จาก HOSxP (MySQL) มาตัดยอดอัตโนมัติทุกวัน แทนการวางไฟล์ด้วยมือ</div>
    </div>
  );
}
