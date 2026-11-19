// Shown to a signed-in user whose password an admin just reset (users/{uid}.mustChangePassword):
// they logged in with a temporary password and must choose their own before using the app.
import { useState } from 'react';
import { useApp } from '../store/AppContext';

export default function ForcePasswordScreen() {
  const { myProfile, changeMyPassword, logout } = useApp();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSave = pw.length >= 6 && pw === pw2 && !busy;
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try { await changeMyPassword(pw); } finally { setBusy(false); }
  };
  const field = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '12px', fontSize: 16, minHeight: 48 } as const;
  return (
    <div className="app-shell" style={{ justifyContent: 'center', padding: 'calc(env(safe-area-inset-top, 0px) + 28px) 22px 28px', overflowY: 'auto' }}>
      <div className="card" style={{ padding: 18, maxWidth: 420, width: '100%', margin: '0 auto' }}>
        <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">🔑</div>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>ตั้งรหัสผ่านใหม่</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
          {myProfile?.name ? myProfile.name + ' — ' : ''}Admin รีเซ็ตรหัสผ่านของคุณแล้ว กรุณาตั้งรหัสผ่านของคุณเองก่อนใช้งาน (อย่างน้อย 6 ตัวอักษร)
        </div>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 3 }}>รหัสผ่านใหม่</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          <span className="muted" style={{ display: 'block', fontSize: 11.5, marginBottom: 3 }}>ยืนยันรหัสผ่านใหม่</span>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} style={field} />
        </label>
        <div role="status" style={{ minHeight: 18, fontSize: 11.5, color: 'var(--red)', marginBottom: 8 }}>{mismatch ? 'รหัสผ่านสองช่องไม่ตรงกัน' : ''}</div>
        <button onClick={() => void save()} disabled={!canSave} className="btn-primary" style={{ width: '100%', minHeight: 50, borderRadius: 11, fontSize: 15, fontWeight: 700, opacity: canSave ? 1 : 0.5 }}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
        </button>
        <button onClick={logout} className="btn-outline" style={{ width: '100%', minHeight: 44, borderRadius: 11, fontSize: 13, marginTop: 8 }}>ออกจากระบบ</button>
      </div>
    </div>
  );
}
