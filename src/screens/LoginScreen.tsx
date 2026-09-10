import { useState } from 'react';
import { useApp } from '../store/AppContext';
import HospitalCrest from '../components/HospitalCrest';
import versionRaw from '../../VERSION?raw';

// Same "?raw" VERSION import MoreScreen already uses — one source of truth for the version
// string, now also surfaced on Login so staff can read it off before they're even signed in
// (useful when reporting a bug over the phone, or confirming a device auto-updated).
const APP_VERSION = versionRaw.trim();

const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

const FEATURES: [string, string, string][] = [
  ['🛡️', 'ควบคุมสิทธิ์ตามบทบาท', 'Admin · เภสัชกร · ผู้ช่วยเภสัชกร — แต่ละบทบาทเห็น/แก้ได้ต่างกันจริง'],
  ['📜', 'Audit log ทุกการทำรายการ', 'ล็อกอิน ปรับยอด อนุมัติ — ย้อนดูได้เสมอว่าใครทำอะไรเมื่อไร'],
  ['⏰', 'แจ้งเตือนยาใกล้หมดอายุ', 'ตั้งจำนวนวันแจ้งเตือนล่วงหน้าได้ในหน้าตั้งค่า'],
];

export default function LoginScreen() {
  const {
    state, myProfile, setAuthMode, setAuthUsername, setAuthPassword, setAuthName, setAuthDept,
    setAuthRemember, signIn, signUp, logout, theme, toggleTheme,
  } = useApp();

  const ThemeToggleBtn = (
    <button
      onClick={toggleTheme}
      className="theme-toggle press-spring"
      style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', right: 20, zIndex: 2 }}
      title={theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
      aria-label={theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
    >
      <span key={theme} className="icon">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );

  // Network status, readable before signing in — this is the same state.online flag the
  // header shows once inside the app (tracked globally in AppContext via window
  // online/offline listeners), surfaced here too because rural/hospital-wifi drops are
  // exactly when a stuck-looking login screen is most confusing.
  const OnlineBadge = (
    <div
      title={state.online ? 'เชื่อมต่ออินเทอร์เน็ตอยู่' : 'ออฟไลน์ — เข้าสู่ระบบไม่ได้จนกว่าจะกลับมาออนไลน์'}
      style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: 20, zIndex: 2, border: 0, background: state.online ? 'rgba(255,255,255,.14)' : 'var(--amber-bg)', color: state.online ? 'var(--ink-soft)' : 'var(--amber-ink)', padding: '7px 10px', borderRadius: 9, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: state.online ? '#5adc8c' : 'var(--amber)', display: 'inline-block', animation: state.online ? 'glowPulse 2.4s infinite' : 'none', flex: 'none' }} />
      {state.online ? 'ออนไลน์' : 'ออฟไลน์'}
    </div>
  );

  if (state.authStatus === 'loading') {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center', background: 'var(--login-bg)', overflowY: 'auto' }}>
        <div className="mesh-bg" aria-hidden="true" />
        <div className="login-pattern" aria-hidden="true" />
        <div style={{ position: 'relative', color: 'var(--ink-soft)', opacity: 0.8, fontSize: 13 }}>กำลังเชื่อมต่อ…</div>
      </div>
    );
  }

  if (state.authStatus === 'pendingApproval') {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', padding: 'calc(env(safe-area-inset-top, 0px) + 32px) 26px calc(env(safe-area-inset-bottom, 0px) + 32px)', background: 'var(--login-bg)', color: 'var(--ink-soft)', textAlign: 'center', overflowY: 'auto' }}>
        <div className="mesh-bg" aria-hidden="true" />
        <div className="login-pattern" aria-hidden="true" />
        {OnlineBadge}
        {ThemeToggleBtn}
        <div style={{ position: 'relative', width: 62, height: 62, borderRadius: '50%', background: 'rgba(242,245,239,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 18px' }}>⏳</div>
        <div style={{ position: 'relative', fontSize: 19, fontWeight: 700, marginBottom: 6 }}>รอ Admin อนุมัติบัญชี</div>
        <div style={{ position: 'relative', fontSize: 13.5, opacity: 0.78, lineHeight: 1.6, marginBottom: 4 }}>
          บัญชี <b>{myProfile?.name}</b> (@{myProfile?.username}) สมัครสำเร็จแล้ว
        </div>
        <div style={{ position: 'relative', fontSize: 13, opacity: 0.65, lineHeight: 1.6, marginBottom: 26 }}>
          รอเภสัชกรหรือ Admin กดอนุมัติและกำหนดบทบาทให้ก่อน จึงจะเข้าใช้งานได้ — ลองเข้าสู่ระบบใหม่อีกครั้งภายหลัง
        </div>
        <button onClick={logout} className="login-btn" style={{ position: 'relative', width: '100%', border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: 'var(--ink-soft)', padding: 14, borderRadius: 12, fontSize: 14 }}>ออกจากระบบ</button>
      </div>
    );
  }

  const isRegister = state.authMode === 'register';

  return (
    <div className="app-shell" style={{ background: 'var(--login-bg)', overflowY: 'auto' }}>
      <div className="mesh-bg" aria-hidden="true" />
      <div className="login-pattern" aria-hidden="true" />
      {OnlineBadge}
      {ThemeToggleBtn}
      {/* Trust strip — real, already-shipped features, not decoration. Shown above the form
          on every screen size (a single column on phones, where this app is actually used;
          the extra width on a tablet just gives the card more breathing room, not a second
          column, since a split layout only makes sense wider than this app is ever opened). */}
      <div style={{ position: 'relative', padding: 'calc(env(safe-area-inset-top, 0px) + 26px) 26px 6px', maxWidth: 440, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, animation: 'fade .4s var(--ease-out) both' }}>
          {/* Entrance: a quick spring "pop" (reusing the same .pop keyframe the rest of the app
              uses for cards/sheets appearing) plays once on load, then the badge settles into
              its usual ambient glowPulse loop — so the crest feels like it arrives rather than
              just being statically present. */}
          <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #ffffff, #f4f2ec)', border: '1px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 11, flex: 'none', animation: 'pop .5s var(--ease-spring) both, glowPulse 3.2s infinite .5s', boxShadow: '0 10px 26px -8px rgba(0,0,0,.4), 0 0 0 6px rgba(var(--brand-coral-rgb),.14)' }}><HospitalCrest size={42} /></div>
          {/* Formal wordmark lockup: hospital abbreviation as the primary mark (large, tight
              tracking, the weight a logotype carries), the module name as a letter-spaced
              uppercase eyebrow underneath, then the full Thai name/ward line last — same info
              as before ("KPNHOS-DRUG SUBSTOCK-OPD-IPD-MANAGEMENT" run together on one line) but
              now laid out in a clear, deliberate hierarchy instead of one dense string. */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '.02em', color: 'var(--ink-soft)', lineHeight: 1.15 }}>KPNHOS</div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(var(--brand-coral-rgb),.95)', marginTop: 5 }}>Drug Substock · OPD–IPD Management</div>
            <div style={{ fontSize: 12, color: 'rgba(242,245,239,.62)', marginTop: 7, letterSpacing: '.01em' }}>โรงพยาบาลกรงปินัง · งานเภสัชกรรม จ.ยะลา</div>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', maxWidth: 440, margin: '0 auto', width: '100%', padding: '0 20px calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>
        <div style={{ position: 'relative', overflow: 'hidden', background: 'rgba(255,255,255,.075)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 24, padding: '26px 24px 24px', marginTop: 22, animation: 'fade .4s var(--ease-out) both', animationDelay: '60ms', boxShadow: '0 24px 60px -18px rgba(0,0,0,.5), var(--shadow-lg)' }}>
          {/* A thin, slowly-shifting two-tone highlight along the top edge — the same "this
              surface is genuinely alive, not a static screenshot" cue the rest of the app's
              premium chrome (mesh-bg, glowPulse) already uses, scaled down to a hairline so it
              reads as ambient polish, not a distraction from the actual form underneath. Tinted
              teal→coral→teal so this hairline echoes the crest's own two-tone palette instead
              of a generic white shimmer. */}
          <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent, var(--green-bright), rgba(var(--brand-coral-rgb),.9), var(--green-bright), transparent)', backgroundSize: '200% 100%', animation: 'aiGradientShift 4.5s ease-in-out infinite' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 5 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(140deg, var(--ink-soft), #d8e6dc)', color: 'var(--green-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flex: 'none', boxShadow: '0 4px 14px -4px rgba(0,0,0,.35)' }}>🔒</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19.5, fontWeight: 700, color: 'var(--ink-soft)', lineHeight: 1.25 }}>{isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(242,245,239,.5)', marginTop: 1 }}>บัญชีเจ้าหน้าที่ห้องยา</div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(242,245,239,.65)', marginTop: 10, marginBottom: 20, lineHeight: 1.55 }}>
            {isRegister ? 'สมัครด้วยบัญชีเจ้าหน้าที่ห้องยา — รออนุมัติก่อนเข้าใช้งาน' : 'ลงชื่อเข้าใช้ด้วยบัญชีเจ้าหน้าที่ห้องยา'}
          </div>

          <div style={{ position: 'relative', display: 'flex', gap: 2, background: 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.08)', padding: 3, borderRadius: 12, marginBottom: 18 }}>
            <span style={{ position: 'absolute', top: 3, bottom: 3, left: isRegister ? '50%' : 3, width: 'calc(50% - 3px)', background: 'var(--ink-soft)', borderRadius: 9, boxShadow: '0 3px 10px -3px rgba(0,0,0,.4)', transition: 'left var(--dur-slow) var(--ease-spring)' }} />
            <button onClick={() => setAuthMode('login')} className="press-spring" style={{ position: 'relative', flex: 1, border: 0, background: 'transparent', color: !isRegister ? 'var(--ink)' : 'rgba(242,245,239,.75)', padding: '10px 0', borderRadius: 9, fontSize: 13.5, fontWeight: 600 }}>เข้าสู่ระบบ</button>
            <button onClick={() => setAuthMode('register')} className="press-spring" style={{ position: 'relative', flex: 1, border: 0, background: 'transparent', color: isRegister ? 'var(--ink)' : 'rgba(242,245,239,.75)', padding: '10px 0', borderRadius: 9, fontSize: 13.5, fontWeight: 600 }}>สมัครสมาชิก</button>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); isRegister ? signUp() : signIn(); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {isRegister && (
              <>
                <Field icon="👤" label="ชื่อ-สกุล" value={state.authName} onChange={setAuthName} placeholder="เช่น ภญ.นูรฮายาตี ส." autoComplete="name" />
                <Field icon="🏥" label="แผนก" value={state.authDept} onChange={setAuthDept} placeholder="เภสัชกรรม" />
              </>
            )}
            <Field
              icon="🪪" label="ชื่อผู้ใช้ / Username" value={state.authUsername} onChange={(v) => setAuthUsername(v.toLowerCase())} autoComplete="username"
              // Live ✓/✗ only makes sense in register mode — on login the username is
              // whatever it already is, this pattern can't say if it's actually registered.
              valid={isRegister && state.authUsername ? USERNAME_RE.test(state.authUsername) : null}
            />
            {isRegister && <div style={{ fontSize: 11, opacity: 0.55, margin: '-4px 0 0' }}>ตัวอักษรอังกฤษเล็ก ตัวเลข . หรือ _ เท่านั้น (3-20 ตัว)</div>}
            <PasswordField
              value={state.authPassword} onChange={setAuthPassword} placeholder={isRegister ? 'อย่างน้อย 6 ตัวอักษร' : '••••••••'} autoComplete={isRegister ? 'new-password' : 'current-password'}
              valid={isRegister && state.authPassword ? state.authPassword.length >= 6 : null}
            />

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
              className="login-btn press-spring"
              style={{ border: 0, background: 'linear-gradient(135deg, var(--ink-soft), #dfe9e1)', color: 'var(--ink)', padding: '15px 18px', borderRadius: 14, fontSize: 15, fontWeight: 700, letterSpacing: '.01em', marginTop: 4, minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 14px 30px -12px rgba(0,0,0,.5)' }}
            >
              {state.authBusy ? (
                <>
                  <span className="spin" aria-hidden="true" style={{ width: 15, height: 15, border: '2px solid rgba(18,33,26,.25)', borderTopColor: 'var(--ink)', borderRadius: '50%' }} />
                  กำลังดำเนินการ…
                </>
              ) : (
                <>
                  {isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
                  <span className="login-arrow" aria-hidden="true">→</span>
                </>
              )}
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

        <div style={{ background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 18, padding: '4px 16px', marginTop: 18 }}>
          {FEATURES.map(([icon, title, sub], i) => (
            <div
              key={title}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start', padding: '13px 0',
                borderTop: i === 0 ? undefined : '1px solid rgba(255,255,255,.08)',
                animation: 'fade .4s var(--ease-out) both', animationDelay: `${120 + i * 70}ms`,
              }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.1)', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flex: 'none' }}>{icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{title}</div>
                <div style={{ fontSize: 11, color: 'rgba(242,245,239,.6)', lineHeight: 1.5, marginTop: 1 }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: 10.5, color: 'rgba(242,245,239,.4)', letterSpacing: '.04em', marginTop: 18, lineHeight: 1.8 }}>
          <div>© งานเภสัชกรรม โรงพยาบาลกรงปินัง · เวอร์ชัน {APP_VERSION}</div>
          <div>พัฒนาแอพโดย ภก.อนัส มะยีแต</div>
        </div>
      </div>
    </div>
  );
}

// `valid`: null/undefined = no live check shown (e.g. on login, or an empty field);
// true/false = render a ✓/✗ once there's something to judge. Only register-mode fields pass
// a real value for this — it's a "will this even pass validation before you hit submit" nudge,
// not a password-strength meter.
function Field({ icon, label, value, onChange, type = 'text', placeholder, autoComplete, valid }: { icon: string; label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string; valid?: boolean | null }) {
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
          className="login-field"
          // Bug fix (mobile fit): a text input under 16px makes iOS Safari auto-zoom the
          // whole page in on focus — the very first thing anyone does on this app on their
          // phone is tap this field, so the zoom hit every single login on an iPhone/iPad.
          style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: `13px ${valid == null ? 14 : 34}px 13px 36px`, fontSize: 16, minHeight: 46 }}
        />
        {valid != null && (
          <span aria-hidden="true" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: valid ? 'var(--green-bright)' : 'var(--red)', animation: 'checkPop .25s var(--ease-spring)' }}>{valid ? '✓' : '✗'}</span>
        )}
      </div>
    </label>
  );
}

function PasswordField({ value, onChange, placeholder, autoComplete, valid }: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; valid?: boolean | null }) {
  const [show, setShow] = useState(false);
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11.5, opacity: 0.7, marginBottom: 4, fontWeight: 600 }}>รหัสผ่าน</span>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.55, pointerEvents: 'none' }}>🔑</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className="login-field"
          style={{ width: '100%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: 'var(--ink-soft)', borderRadius: 10, padding: `13px ${valid == null ? 40 : 60}px 13px 36px`, fontSize: 16, minHeight: 46 }}
        />
        {valid != null && (
          <span aria-hidden="true" style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: valid ? 'var(--green-bright)' : 'var(--red)', animation: 'checkPop .25s var(--ease-spring)' }}>{valid ? '✓' : '✗'}</span>
        )}
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          className="press-spring"
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', color: 'var(--ink-soft)', opacity: 0.75, width: 32, height: 32, borderRadius: 8, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {show ? '🙈' : '👁️'}
        </button>
      </div>
    </label>
  );
}
