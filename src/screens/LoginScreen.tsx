import { useApp } from '../store/AppContext';

export default function LoginScreen() {
  const { doLogin } = useApp();
  return (
    <div className="app-shell" style={{ justifyContent: 'center', padding: '32px 26px', background: 'var(--green)', color: 'var(--ink-soft)' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--ink-soft)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 19, marginBottom: 22 }}>ยา</div>
      <div style={{ fontSize: 13, letterSpacing: '.06em', opacity: 0.72, fontWeight: 600 }}>รพ.กรงปินัง · ห้องยาผู้ป่วยนอก</div>
      <div style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.25, margin: '6px 0 4px' }}>ระบบจัดการสต็อกยา</div>
      <div style={{ fontSize: 14, opacity: 0.72, lineHeight: 1.55, marginBottom: 30 }}>คลังย่อยห้องยา → หน้างานจ่ายยา · ติดตาม lot และวันหมดอายุแบบ FEFO</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <button onClick={() => doLogin('pharm')} style={{ border: 0, background: 'var(--ink-soft)', color: 'var(--ink)', padding: '16px 18px', borderRadius: 12, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>ภญ.นูรฮายาตี ส.</span>
            <span style={{ display: 'block', fontSize: 12.5, color: '#6b7269' }}>เภสัชกร · อนุมัติรับเข้า ปรับยอด ตั้ง par</span>
          </span>
          <span style={{ fontSize: 18, color: 'var(--green)' }}>→</span>
        </button>
        <button onClick={() => doLogin('tech')} style={{ border: 0, background: 'rgba(242,245,239,.14)', color: 'var(--ink-soft)', padding: '16px 18px', borderRadius: 12, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>อับดุลเลาะ ม.</span>
            <span style={{ display: 'block', fontSize: 12.5, opacity: 0.65 }}>ผู้ช่วยเภสัชกร · เติมหน้างาน จ่ายยา สแกน QR</span>
          </span>
          <span style={{ fontSize: 18, opacity: 0.7 }}>→</span>
        </button>
        <button onClick={() => doLogin('admin')} style={{ border: 0, background: 'rgba(242,245,239,.14)', color: 'var(--ink-soft)', padding: '16px 18px', borderRadius: 12, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>ผู้ดูแลระบบ</span>
            <span style={{ display: 'block', fontSize: 12.5, opacity: 0.65 }}>Admin · master data ยา ผู้ใช้ ฉลาก QR</span>
          </span>
          <span style={{ fontSize: 18, opacity: 0.7 }}>→</span>
        </button>
      </div>
      <div style={{ marginTop: 26, fontSize: 11.5, opacity: 0.55, lineHeight: 1.5 }}>เดโม: กดเลือกบทบาทเพื่อเข้าใช้งาน — ระบบจริงใช้ Firebase Auth และสิทธิ์ตาม role</div>
    </div>
  );
}
