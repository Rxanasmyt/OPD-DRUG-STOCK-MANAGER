import { useApp } from '../store/AppContext';

export default function LoginScreen() {
  const { state, myProfile, setAuthMode, setAuthEmail, setAuthPassword, setAuthName, setAuthDept, signIn, signUp, logout } = useApp();

  if (state.authStatus === 'loading') {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center', background: 'var(--green)' }}>
        <div style={{ color: 'var(--ink-soft)', opacity: 0.8, fontSize: 13 }}>กำลังเชื่อมต่อ…</div>
      </div>
    );
  }

  if (state.authStatus === 'pendingApproval') {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', padding: '32px 26px', background: 'var(--green)', color: 'var(--ink-soft)', textAlign: 'center' }}>
        <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(242,245,239,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 18px' }}>⏳</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>รอ Admin อนุมัติบัญชี</div>
        <div style={{ fontSize: 13.5, opacity: 0.78, lineHeight: 1.6, marginBottom: 4 }}>
          บัญชี <b>{myProfile?.name}</b> ({myProfile?.email}) สมัครสำเร็จแล้ว
        </div>
        <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.6, marginBottom: 26 }}>
          รอเภสัชกรหรือ Admin กดอนุมัติและกำหนดบทบาทให้ก่อน จึงจะเข้าใช้งานได้ — ลองเข้าสู่ระบบใหม่อีกครั้งภายหลัง
        </div>
        <button onClick={logout} className="login-btn" style={{ width: '100%', border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: 'var(--ink-soft)', padding: 14, borderRadius: 12, fontSize: 14 }}>ออกจากระบบ</button>
      </div>
    );
  }

  const isRegister = state.authMode === 'register';

  return (
    <div className="app-shell" style={{ justifyContent: 'center', padding: '32px 26px', background: 'var(--green)', color: 'var(--ink-soft)' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--ink-soft)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 19, marginBottom: 22, animation: 'fade .4s var(--ease-out) both' }}>ยา</div>
      <div style={{ fontSize: 13, letterSpacing: '.06em', opacity: 0.72, fontWeight: 600, animation: 'fade .4s var(--ease-out) both', animationDelay: '40ms' }}>รพ.กรงปินัง · ห้องยาผู้ป่วยนอก</div>
      <div style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.25, margin: '6px 0 4px', animation: 'fade .4s var(--ease-out) both', animationDelay: '80ms' }}>ระบบจัดการสต็อกยา</div>
      <div style={{ fontSize: 14, opacity: 0.72, lineHeight: 1.55, marginBottom: 26, animation: 'fade .4s var(--ease-out) both', animationDelay: '120ms' }}>คลังย่อยห้องยา → หน้างานจ่ายยา · ติดตาม lot และวันหมดอายุแบบ FEFO</div>

      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.09)', padding: 3, borderRadius: 11, marginBottom: 18, animation: 'fade .4s var(--ease-out) both', animationDelay: '150ms' }}>
        <button onClick={() => setAuthMode('login')} style={{ flex: 1, border: 0, background: !isRegister ? 'var(--ink-soft)' : 'transparent', color: !isRegister ? 'var(--ink)' : 'rgba(242,245,239,.75)', padding: '10px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600 }}>เข้าสู่ระบบ</button>
        <button onClick={() => setAuthMode('register')} style={{ flex: 1, border: 0, background: isRegister ? 'var(--ink-soft)' : 'transparent', color: isRegister ? 'var(--ink)' : 'rgba(242,245,239,.75)', padding: '10px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600 }}>สมัครสมาชิก</button>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); isRegister ? signUp() : signIn(); }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'fade .4s var(--ease-out) both', animationDelay: '180ms' }}
      >
        {isRegister && (
          <>
            <Field label="ชื่อ-สกุล" value={state.authName} onChange={setAuthName} placeholder="เช่น ภญ.นูรฮายาตี ส." autoComplete="name" />
            <Field label="แผนก" value={state.authDept} onChange={setAuthDept} placeholder="เภสัชกรรม" />
          </>
        )}
        <Field label="อีเมล" value={state.authEmail} onChange={setAuthEmail} type="email" placeholder="name@hospital.go.th" autoComplete="email" />
        <Field label="รหัสผ่าน" value={state.authPassword} onChange={setAuthPassword} type="password" placeholder={isRegister ? 'อย่างน้อย 6 ตัวอักษร' : '••••••••'} autoComplete={isRegister ? 'new-password' : 'current-password'} />

        {state.authError && (
          <div style={{ background: 'rgba(163,43,34,.25)', border: '1px solid rgba(255,255,255,.2)', color: 'var(--ink-soft)', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, animation: 'fade .2s var(--ease-out)' }}>
            {state.authError}
          </div>
        )}

        <button
          type="submit"
          disabled={state.authBusy}
          className="login-btn"
          style={{ border: 0, background: 'var(--ink-soft)', color: 'var(--ink)', padding: '15px 18px', borderRadius: 12, fontSize: 15, fontWeight: 600, marginTop: 4, minHeight: 50 }}
        >
          {state.authBusy ? 'กำลังดำเนินการ…' : isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
        </button>
      </form>

      {isRegister && (
        <div style={{ marginTop: 14, fontSize: 11.5, opacity: 0.6, lineHeight: 1.6, animation: 'fade .4s var(--ease-out) both', animationDelay: '220ms' }}>
          สมัครแล้วบัญชีจะอยู่ในสถานะรออนุมัติ — เภสัชกรหรือ Admin ต้องกดอนุมัติและกำหนดบทบาทให้ก่อนจึงเข้าใช้งานได้
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, autoComplete }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11.5, opacity: 0.7, marginBottom: 4, fontWeight: 600 }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: '13px 14px', fontSize: 14.5, minHeight: 46 }}
      />
    </label>
  );
}
