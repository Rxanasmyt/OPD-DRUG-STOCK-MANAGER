import { useApp } from '../store/AppContext';

export default function DoneScreen() {
  const { state, go, doneAgain } = useApp();
  const title = state.doneKind === 'receive' ? 'รับเข้า substock สำเร็จ' : state.doneKind === 'recvPending' ? 'ส่งให้เภสัชกรอนุมัติแล้ว' : 'เติมหน้างานสำเร็จ';
  const sub = state.doneKind === 'recvPending'
    ? 'ยอดจะเข้าสต็อกก็ต่อเมื่อเภสัชกร/แอดมินกดอนุมัติในหน้า "รับยาเข้า" — รายการอยู่ในสถานะรออนุมัติแล้ว'
    : state.online ? 'บันทึกและ audit trail แล้ว' : 'บันทึกไว้ในเครื่อง จะ sync ให้เมื่อกลับมาออนไลน์';

  return (
    <div style={{ padding: '34px 20px', textAlign: 'center', animation: 'fade .24s var(--ease-out)' }}>
      <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'var(--green-tint)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, margin: '0 auto 16px', animation: 'checkPop .5s var(--ease-out)' }}>✓</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{title}</div>
      <div className="muted" style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.6 }}>{sub}</div>
      <div className="card" style={{ textAlign: 'left', margin: '18px 0', overflow: 'hidden' }}>
        {state.doneRows.map((d, i) => (
          <div key={i} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'space-between', gap: 10, animation: `fade .3s var(--ease-out) both`, animationDelay: `${Math.min(i, 6) * 40}ms` }}>
            <span style={{ fontSize: 13, minWidth: 0 }}>{d.name}<span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{d.sub}</span></span>
            <span style={{ fontSize: 13.5, fontWeight: 700, flex: 'none' }}>{d.qty}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <button onClick={() => go('home')} style={{ flex: 1, border: '1px solid var(--border)', background: 'var(--bg-card)', padding: 14, borderRadius: 12, fontSize: 14.5, fontWeight: 600, minHeight: 50 }}>กลับหน้าหลัก</button>
        <button onClick={doneAgain} className="btn-primary" style={{ flex: 1, padding: 14, borderRadius: 12, fontSize: 14.5, minHeight: 50 }}>ทำรายการต่อ</button>
      </div>
    </div>
  );
}
