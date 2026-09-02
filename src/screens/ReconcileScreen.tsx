import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';
import type { HosxpMatch } from '../types';

export default function ReconcileScreen() {
  const { state, setHosxpText, processHosxp, setHosxpConfirmFuzzy, commitReconcile } = useApp();

  const medById = (id: string) => state.meds.find((x) => x.id === id);

  const reconcileRows = (state.hosxpRows || []).map((r) => {
    const med = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? medById(r.match.medId) : undefined;
    const before = med ? med.floor : 0;
    const after = med ? Math.max(0, before - r.qty) : 0;
    return { fileText: r.name, qty: r.qty, match: r.match, med, before, after };
  });

  const fuzzyCount = reconcileRows.filter((r) => r.match.kind === 'fuzzy').length;
  const skippedCount = reconcileRows.filter((r) => r.match.kind === 'ambiguous' || r.match.kind === 'none').length;
  const canCommit = reconcileRows.length > 0 && (fuzzyCount === 0 || state.hosxpConfirmFuzzy);

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        วิธีหลักในการตัดยอดหน้างาน — ใช้เป็นประจำทุกวัน เร็วกว่าการนับสต็อกจริง วางไฟล์ CSV ที่ IT export จาก HOSxP (ชื่อยา, จำนวนจ่าย) ระบบจะตัดยอดหน้างานให้ตรงกับที่จ่ายจริงโดยตรง
      </div>
      <textarea
        value={state.hosxpText}
        onChange={(e) => setHosxpText(e.target.value)}
        placeholder={'วางข้อมูลจากไฟล์ HOSxP รูปแบบ "ชื่อยา,จำนวนที่จ่าย" บรรทัดละ 1 รายการ เช่น\nPARACETAMOL 500 mg,340\namlodipine 5 mg,120'}
        style={{ width: '100%', minHeight: 120, border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 13, fontFamily: 'ui-monospace, monospace', resize: 'vertical', marginBottom: 10 }}
      />
      <button onClick={processHosxp} className="btn-primary" style={{ width: '100%', padding: 11, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46, marginBottom: 14 }}>ประมวลผล</button>

      {reconcileRows.length > 0 && (
        <>
          <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 13 }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>รายการยา</span><span style={{ width: 70, textAlign: 'right', flex: 'none' }}>จ่ายจริง</span><span style={{ width: 70, textAlign: 'right', flex: 'none' }}>ก่อน → หลัง</span>
            </div>
            {reconcileRows.map((r, i) => (
              <div key={i} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3, fontWeight: r.match.kind === 'exact' ? 400 : 600 }}>
                    {r.med ? r.med.name : r.fileText}
                  </span>
                  <span style={{ width: 70, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>{r.med ? '−' + nf(r.qty) : '—'}</span>
                  <span className="muted" style={{ width: 70, textAlign: 'right', flex: 'none', fontSize: 12.5 }}>{r.med ? nf(r.before) + '→' + nf(r.after) : '—'}</span>
                </div>
                <MatchBadge match={r.match} fileText={r.fileText} medById={medById} />
              </div>
            ))}
          </div>

          {fuzzyCount > 0 && (
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, padding: '11px 12px', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={state.hosxpConfirmFuzzy} onChange={(e) => setHosxpConfirmFuzzy(e.target.checked)} style={{ marginTop: 2, flex: 'none', width: 17, height: 17 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--amber-ink)' }}>ตรวจสอบแล้วว่า {fuzzyCount} รายการที่ทำเครื่องหมาย ⚠ ด้านบน จับคู่กับยาถูกตัว (ชื่อในไฟล์ไม่ตรงกับชื่อในระบบเป๊ะๆ ระบบเดาให้จากชื่อที่ใกล้เคียงที่สุด)</span>
            </label>
          )}

          <button onClick={commitReconcile} disabled={!canCommit} className="btn-primary" style={{ width: '100%', padding: 15, borderRadius: 12, fontSize: 15, minHeight: 52, opacity: canCommit ? 1 : 0.5 }}>
            ตัดยอดหน้างานตามไฟล์นี้ และบันทึก discrepancy log{skippedCount > 0 ? ' (ข้าม ' + skippedCount + ' รายการที่จับคู่ไม่ได้)' : ''}
          </button>
        </>
      )}
    </div>
  );
}

function MatchBadge({ match, fileText, medById }: { match: HosxpMatch; fileText: string; medById: (id: string) => { name: string } | undefined }) {
  if (match.kind === 'exact') return null; // clean match — no need to draw attention
  if (match.kind === 'fuzzy') {
    return <div style={{ fontSize: 10.5, color: 'var(--amber-ink)', fontWeight: 600, marginTop: 3 }}>⚠ ไม่ตรงชื่อเป๊ะ — ไฟล์เขียนว่า "{fileText}"</div>;
  }
  if (match.kind === 'ambiguous') {
    const names = match.candidateIds.map((id) => medById(id)?.name).filter(Boolean).join(', ');
    return <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 600, marginTop: 3 }}>✕ พบยาที่ชื่อใกล้เคียงกันหลายรายการ — ข้าม ({names})</div>;
  }
  return <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 600, marginTop: 3 }}>✕ ไม่พบยานี้ในระบบ — ข้าม</div>;
}
