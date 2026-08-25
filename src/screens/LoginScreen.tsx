import { useApp } from '../store/AppContext';
import type { Role } from '../types';

const ROLES: [Role, string, string, boolean][] = [
  ['pharm', 'ภญ.นูรฮายาตี ส.', 'เภสัชกร · อนุมัติรับเข้า ปรับยอด ตั้ง par', true],
  ['tech', 'อับดุลเลาะ ม.', 'ผู้ช่วยเภสัชกร · เติมหน้างาน จ่ายยา สแกน QR', false],
  ['admin', 'ผู้ดูแลระบบ', 'Admin · master data ยา ผู้ใช้ ฉลาก QR', false],
];

export default function LoginScreen() {
  const { doLogin } = useApp();
  return (
    <div className="app-shell" style={{ justifyContent: 'center', padding: '32px 26px', background: 'var(--green)', color: 'var(--ink-soft)' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--ink-soft)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 19, marginBottom: 22, animation: 'fade .4s var(--ease-out) both' }}>ยา</div>
      <div style={{ fontSize: 13, letterSpacing: '.06em', opacity: 0.72, fontWeight: 600, animation: 'fade .4s var(--ease-out) both', animationDelay: '40ms' }}>รพ.กรงปินัง · ห้องยาผู้ป่วยนอก</div>
      <div style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.25, margin: '6px 0 4px', animation: 'fade .4s var(--ease-out) both', animationDelay: '80ms' }}>ระบบจัดการสต็อกยา</div>
      <div style={{ fontSize: 14, opacity: 0.72, lineHeight: 1.55, marginBottom: 30, animation: 'fade .4s var(--ease-out) both', animationDelay: '120ms' }}>คลังย่อยห้องยา → หน้างานจ่ายยา · ติดตาม lot และวันหมดอายุแบบ FEFO</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {ROLES.map(([role, name, desc, primary], i) => (
          <button
            key={role}
            onClick={() => doLogin(role)}
            className="login-btn"
            style={{
              border: 0,
              background: primary ? 'var(--ink-soft)' : 'rgba(242,245,239,.14)',
              color: primary ? 'var(--ink)' : 'var(--ink-soft)',
              padding: '16px 18px', borderRadius: 12, textAlign: 'left',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              animation: 'fade .4s var(--ease-out) both', animationDelay: `${160 + i * 60}ms`,
            }}
          >
            <span>
              <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{name}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: primary ? '#6b7269' : undefined, opacity: primary ? 1 : 0.65 }}>{desc}</span>
            </span>
            <span className="login-arrow" style={{ fontSize: 18, color: primary ? 'var(--green)' : undefined, opacity: primary ? 1 : 0.7 }}>→</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 26, fontSize: 11.5, opacity: 0.55, lineHeight: 1.5, animation: 'fade .4s var(--ease-out) both', animationDelay: '340ms' }}>เดโม: กดเลือกบทบาทเพื่อเข้าใช้งาน — ระบบจริงใช้ Firebase Auth และสิทธิ์ตาม role</div>
    </div>
  );
}
