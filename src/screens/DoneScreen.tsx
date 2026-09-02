import { useApp } from '../store/AppContext';
import { usesSubstock } from '../store/selectors';
import { nf, fiscalYear } from '../utils/format';

export default function DoneScreen() {
  const { state, sub, go, doneAgain, goSubstockCardFor } = useApp();
  const medById = (id?: string) => (id ? state.meds.find((m) => m.id === id) : undefined);
  const title = state.doneKind === 'receive' ? 'รับเข้า substock สำเร็จ' : state.doneKind === 'recvPending' ? 'ส่งให้เภสัชกรอนุมัติแล้ว' : 'เติมหน้างานสำเร็จ';
  const subLine = state.doneKind === 'recvPending'
    ? 'ยอดจะเข้าสต็อกก็ต่อเมื่อเภสัชกร/แอดมินกดอนุมัติในหน้า "รับยาเข้า" — รายการอยู่ในสถานะรออนุมัติแล้ว'
    : state.online ? 'บันทึกและ audit trail แล้ว' : 'บันทึกไว้ในเครื่อง จะ sync ให้เมื่อกลับมาออนไลน์';
  // Both "รับเข้า" (คลังใหญ่ → substock) and "เติมหน้างาน" (substock → ชั้นจ่ายยา) move the
  // substock number — this is exactly what the paper บัตรคุมสต็อกยา tracks, kept per
  // ปีงบประมาณ. Show it live right here instead of making someone go check a separate screen.
  const showSubstock = state.doneKind !== 'recvPending';

  return (
    <div style={{ padding: '34px 20px', textAlign: 'center', animation: 'fade .24s var(--ease-out)' }}>
      <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'var(--green-tint)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, margin: '0 auto 16px', animation: 'checkPop .5s var(--ease-out)' }}>✓</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{title}</div>
      <div className="muted" style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.6 }}>{subLine}</div>

      {showSubstock && (
        <div style={{ fontSize: 11, color: 'var(--amber-ink)', background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 20, padding: '4px 11px', display: 'inline-block', margin: '10px 0 0', fontWeight: 700 }}>
          บัตรคุมสต็อกยา · ปีงบประมาณ {fiscalYear()}
        </div>
      )}

      <div className="card" style={{ textAlign: 'left', margin: '14px 0 18px', overflow: 'hidden' }}>
        {state.doneRows.map((d, i) => {
          const m = medById(d.medId);
          // A noSubstock med (liquids/sprays — see usesSubstock) never has a substock
          // balance to show; showing "0" there would read as a problem instead of the
          // by-design "goes straight to the shelf" behavior it actually is.
          const showRowSubstock = showSubstock && m && usesSubstock(m);
          return (
            <div key={i} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', animation: `fade .3s var(--ease-out) both`, animationDelay: `${Math.min(i, 6) * 40}ms` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13, minWidth: 0 }}>{d.name}<span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{d.sub}</span></span>
                <span style={{ fontSize: 13.5, fontWeight: 700, flex: 'none' }}>{d.qty}</span>
              </div>
              {showRowSubstock && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, paddingTop: 7, borderTop: '1px dashed var(--border-soft)' }}>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    substock ตอนนี้ (real-time) <b style={{ color: 'var(--ink)', fontSize: 13 }}>{nf(sub(d.medId!))}</b>
                  </span>
                  <button
                    onClick={() => goSubstockCardFor(d.medId!)}
                    className="press-spring"
                    style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--green)', fontSize: 12, fontWeight: 700, padding: 0 }}
                  >
                    ดูบัตรสต็อก →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 9 }}>
        <button onClick={() => go('home')} style={{ flex: 1, border: '1px solid var(--border)', background: 'var(--bg-card)', padding: 14, borderRadius: 12, fontSize: 14.5, fontWeight: 600, minHeight: 50 }}>กลับหน้าหลัก</button>
        <button onClick={doneAgain} className="btn-primary" style={{ flex: 1, padding: 14, borderRadius: 12, fontSize: 14.5, minHeight: 50 }}>ทำรายการต่อ</button>
      </div>
    </div>
  );
}
