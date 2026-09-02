import { useState } from 'react';
import { useApp } from '../store/AppContext';

const FEATURES: [string, string, string][] = [
  ['◈', 'ควบคุมสิทธิ์ตามบทบาท', 'Admin · เภสัชกร · ผู้ช่วยเภสัชกร — แต่ละบทบาทเห็น/แก้ได้ต่างกันจริง'],
  ['◍', 'Audit log ทุกการทำรายการ', 'ล็อกอิน ปรับยอด อนุมัติ — ย้อนดูได้เสมอว่าใครทำอะไรเมื่อไร'],
  ['◔', 'แจ้งเตือนยาใกล้หมดอายุ', 'ตั้งจำนวนวันแจ้งเตือนล่วงหน้าได้ในหน้าตั้งค่า'],
];

export default function LoginScreen() {
  const {
    state, myProfile, setAuthMode, setAuthUsername, setAuthPassword, setAuthName, setAuthDept,
    setAuthRemember, signIn, signUp, logout,
  } = useApp();

  if (state.authStatus === 'loading') {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center', background: 'var(--login-bg)', overflowY: 'auto' }}>
        <div style={{ color: 'var(--ink-soft)', opacity: 0.8, fontSize: 13 }}>กำลังเชื่อมต่อ…</div>
      </div>
    );
  }

  if (state.authStatus === 'pendingApproval') {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', padding: 'calc(env(safe-area-inset-top, 0px) + 32px) 26px calc(env(safe-area-inset-bottom, 0px) + 32px)', background: 'var(--login-bg)', color: 'var(--ink-soft)', textAlign: 'center', overflowY: 'auto' }}>
        <div style={{ width: 62, height: 62, borderRadius: '50%', background: 'rgba(242,245,239,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 18px' }}>⏳</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>รอ Admin อนุมัติบัญชี</div>
        <div style={{ fontSize: 13.5, opacity: 0.78, lineHeight: 1.6, marginBottom: 4 }}>
          บัญชี <b>{myProfile?.name}</b> (@{myProfile?.username}) สมัครสำเร็จแล้ว
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
    <div className="app-shell" style={{ background: 'var(--login-bg)', overflowY: 'auto' }}>
      {/* Trust strip — real, already-shipped features, not decoration. Shown above the form
          on every screen size (a single column on phones, where this app is actually used;
          the extra width on a tablet just gives the card more breathing room, not a second
          column, since a split layout only makes sense wider than this app is ever opened). */}
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 22px) 26px 4px', maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22, animation: 'fade .4s var(--ease-out) both' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flex: 'none' }}>💊</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-soft)', lineHeight: 1.25 }}>ระบบจัดการสต็อกยา OPD</div>
            <div style={{ fontSize: 11.5, color: 'rgba(242,245,239,.65)' }}>รพ.กรงปินัง · ห้องยาผู้ป่วยนอก</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 440, margin: '0 auto', width: '100%', padding: '0 20px calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>
        <div style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 20, padding: 24, animation: 'fade .4s var(--ease-out) both', animationDelay: '60ms', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--ink-soft)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>🔒</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink-soft)' }}>{isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</div>
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(242,245,239,.65)', marginBottom: 20 }}>
            {isRegister ? 'สมัครด้วยบัญชีเจ้าหน้าที่ห้องยา — รออนุมัติก่อนเข้าใช้งาน' : 'ลงชื่อเข้าใช้ด้วยบัญชีเจ้าหน้าที่ห้องยา'}
          </div>

          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.09)', padding: 3, borderRadius: 11, marginBottom: 18 }}>
            <button onClick={() => setAuthMode('login')} style={{ flex: 1, border: 0, background: !isRegister ? 'var(--ink-soft)' : 'transparent', color: !isRegister ? 'var(--ink)' : 'rgba(242,245,239,.75)', padding: '10px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600 }}>เข้าสู่ระบบ</button>
            <button onClick={() => setAuthMode('register')} style={{ flex: 1, border: 0, background: isRegister ? 'var(--ink-soft)' : 'transparent', color: isRegister ? 'var(--ink)' : 'rgba(242,245,239,.75)', padding: '10px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600 }}>สมัครสมาชิก</button>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); isRegister ? signUp() : signIn(); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {isRegister && (
              <>
                <Field icon="◉" label="ชื่อ-สกุล" value={state.authName} onChange={setAuthName} placeholder="เช่น ภญ.นูรฮายาตี ส." autoComplete="name" />
                <Field icon="▤" label="แผนก" value={state.authDept} onChange={setAuthDept} placeholder="เภสัชกรรม" />
              </>
            )}
            <Field icon="◎" label="ชื่อผู้ใช้ / Username" value={state.authUsername} onChange={(v) => setAuthUsername(v.toLowerCase())} placeholder="เช่น nurhayati" autoComplete="username" />
            {isRegister && <div style={{ fontSize: 11, opacity: 0.55, margin: '-4px 0 0' }}>ตัวอักษรอังกฤษเล็ก ตัวเลข . หรือ _ เท่านั้น (3-20 ตัว)</div>}
            <PasswordField value={state.authPassword} onChange={setAuthPassword} placeholder={isRegister ? 'อย่างน้อย 6 ตัวอักษร' : '••••••••'} autoComplete={isRegister ? 'new-password' : 'current-password'} />

            {!isRegister && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'rgba(242,245,239,.8)', cursor: 'pointer', userSelect: 'none', margin: '-2px 0 2px' }}>
                <input type="checkbox" checked={state.authRemember} onChange={(e) => setAuthRemember(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--ink-soft)' }} />
                จดจำการเข้าใช้ในเครื่องนี้
              </label>
            )}

            {state.authError && (
              <div style={{ background: 'rgba(163,43,34,.25)', border: '1px solid rgba(255,255,255,.2)', color: 'var(--ink-soft)', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, animation: 'fade .2s var(--ease-out)' }}>
                {state.authError}
              </div>
            )}

            <button
              type="submit"
              disabled={state.authBusy}
              className="login-btn"
              style={{ border: 0, background: 'var(--ink-soft)', color: 'var(--ink)', padding: '15px 18px', borderRadius: 12, fontSize: 15, fontWeight: 600, marginTop: 4, minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {state.authBusy ? 'กำลังดำเนินการ…' : (isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ') + ' →'}
            </button>
          </form>

          {isRegister ? (
            <div style={{ marginTop: 14, fontSize: 11.5, opacity: 0.6, lineHeight: 1.6 }}>
              สมัครแล้วบัญชีจะอยู่ในสถานะรออนุมัติ — เภสัชกรหรือ Admin ต้องกดอนุมัติและกำหนดบทบาทให้ก่อนจึงเข้าใช้งานได้
            </div>
          ) : (
            <div style={{ marginTop: 14, fontSize: 11.5, opacity: 0.6, lineHeight: 1.6, textAlign: 'center' }}>
              ลืมรหัสผ่าน? แจ้งเภสัชกร/Admin ห้องยาโดยตรง — ระบบนี้ไม่มีอีเมลกู้คืนรหัสผ่านอัตโนมัติ
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20, animation: 'fade .4s var(--ease-out) both', animationDelay: '120ms' }}>
          {FEATURES.map(([icon, title, sub]) => (
            <div key={title} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.1)', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flex: 'none' }}>{icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{title}</div>
                <div style={{ fontSize: 11, color: 'rgba(242,245,239,.6)', lineHeight: 1.5, marginTop: 1 }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, value, onChange, type = 'text', placeholder, autoComplete }: { icon: string; label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11.5, opacity: 0.7, marginBottom: 4, fontWeight: 600 }}>{label}</span>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.55, pointerEvents: 'none' }}>{icon}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: '13px 14px 13px 36px', fontSize: 14.5, minHeight: 46 }}
        />
      </div>
    </label>
  );
}

function PasswordField({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11.5, opacity: 0.7, marginBottom: 4, fontWeight: 600 }}>รหัสผ่าน</span>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.55, pointerEvents: 'none' }}>◈</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: '13px 40px 13px 36px', fontSize: 14.5, minHeight: 46 }}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', color: 'var(--ink-soft)', opacity: 0.65, width: 32, height: 32, borderRadius: 8, fontSize: 14 }}
        >
          {show ? '◡' : '◉'}
        </button>
      </div>
    </label>
  );
}
