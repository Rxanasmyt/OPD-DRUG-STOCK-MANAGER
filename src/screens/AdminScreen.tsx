import { useApp } from '../store/AppContext';
import { thDate, thTime } from '../utils/format';
import type { AdminTab, AuditFilter, Role, User } from '../types';

const ADMIN_TABS: [AdminTab, string][] = [['users', 'ผู้ใช้งาน'], ['audit', 'Audit log']];
const ROLES: Role[] = ['pharm', 'tech', 'admin'];
const AUDIT_FILTERS: [AuditFilter, string][] = [['all', 'ทั้งหมด'], ['users', 'บัญชีผู้ใช้'], ['stock', 'สต็อก/ธุรกรรม']];
const USER_TYPES = ['login', 'user_registered', 'user_approved', 'user_role_changed', 'user_status_changed'];
const TYPE_LABEL: Record<string, string> = {
  login: 'เข้าสู่ระบบ', user_registered: 'สมัครสมาชิก', user_approved: 'อนุมัติบัญชี', user_role_changed: 'เปลี่ยนบทบาท', user_status_changed: 'เปิด/ปิดบัญชี', par_updated: 'ปรับ par level', qr_manual: 'กรอกรหัส QR ด้วยมือ',
  receive_from_central: 'รับเข้า substock', receive_pending: 'รับเข้า (รออนุมัติ)', transfer_to_floor: 'เติมหน้างาน',
  adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'ยาหมดอายุ', count: 'นับสต็อกหน้างาน', reconcile_hosxp: 'นำเข้า HOSxP',
};

export default function AdminScreen() {
  const { state, setAdminTab, setAuditFilter, setUserRole, toggleUserActive, exportAudit, roleLabelOf } = useApp();
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : '#fff', color: active ? '#fff' : 'var(--ink)' });

  const pending = state.users.filter((u) => !u.active).sort((a, b) => b.createdAt - a.createdAt);
  const approved = state.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const allEntries = [
    ...state.authLog,
    ...state.txs.map((x) => ({ type: x.type, by: x.by, ts: x.ts, note: (x.name ? x.name + ' — ' : '') + (x.note || '') + (x.qty != null ? ' (' + (x.qty > 0 ? '+' : '') + x.qty + ' ' + (x.unit || '') + ')' : '') })),
  ];
  const filtered = allEntries
    .filter((e) => (state.auditFilter === 'all' ? true : state.auditFilter === 'users' ? USER_TYPES.includes(e.type) : !USER_TYPES.includes(e.type)))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 80);

  return (
    <div style={{ animation: 'fade .18s' }}>
      <div style={{ display: 'flex', gap: 7, padding: '12px 14px 10px', overflowX: 'auto', position: 'sticky', top: 0, background: 'var(--bg-app)', zIndex: 2, borderBottom: '1px solid #e6e7e0' }}>
        {ADMIN_TABS.map(([t, label]) => (
          <button key={t} className="chip" style={{ ...chip(state.adminTab === t), minHeight: 38 }} onClick={() => setAdminTab(t)}>
            {label}{t === 'users' && pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 14px 24px' }}>
        {state.adminTab === 'users' && (
          <>
            {pending.length > 0 && (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px', color: 'var(--amber-ink)' }}>รออนุมัติ ({pending.length})</div>
                <div className="card" style={{ overflow: 'hidden', marginBottom: 16, borderColor: 'var(--amber)' }}>
                  {pending.map((u) => <PendingRow key={u.id} u={u} onApprove={() => toggleUserActive(u.id)} roleLabelOf={roleLabelOf} />)}
                </div>
              </>
            )}

            <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px' }}>ผู้ใช้งาน ({approved.length})</div>
            <div className="card" style={{ overflow: 'hidden' }}>
              {approved.map((u) => (
                <div key={u.id} style={{ padding: '12px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{u.name}</div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{u.dept} · @{u.username} · {u.lastLogin ? 'ล็อกอินล่าสุด ' + thDate(u.lastLogin) : 'ยังไม่เคยล็อกอิน'}</div>
                    </div>
                    <span style={{ flex: 'none', fontSize: 11, fontWeight: 700, color: 'var(--green)', background: 'var(--green-tint)', padding: '4px 9px', borderRadius: 20 }}>ใช้งานอยู่</span>
                  </div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                    {ROLES.map((r) => {
                      const active = u.role === r;
                      return <button key={r} onClick={() => setUserRole(u.id, r)} style={{ flex: 1, border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : '#fff', color: active ? '#fff' : 'var(--ink)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>{roleLabelOf(r)}</button>;
                    })}
                    <button onClick={() => toggleUserActive(u.id)} style={{ flex: 'none', border: '1px solid var(--border)', background: '#fff', color: 'var(--red)', padding: '8px 11px', borderRadius: 9, fontSize: 12, minHeight: 38, whiteSpace: 'nowrap' }}>ปิดใช้งาน</button>
                  </div>
                </div>
              ))}
              {approved.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีผู้ใช้งานที่อนุมัติแล้ว</div>}
            </div>
          </>
        )}

        {state.adminTab === 'audit' && (
          <>
            <div style={{ display: 'flex', gap: 7, marginBottom: 11, overflowX: 'auto', paddingBottom: 2 }}>
              {AUDIT_FILTERS.map(([f, label]) => (
                <button key={f} className="chip" style={chip(state.auditFilter === f)} onClick={() => setAuditFilter(f)}>{label}</button>
              ))}
            </div>
            <button onClick={exportAudit} className="btn-outline" style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 14, fontWeight: 600, minHeight: 46, marginBottom: 12 }}>↓ Export CSV — audit_log.csv</button>
            <div className="card" style={{ overflow: 'hidden' }}>
              {filtered.map((e, i) => (
                <div key={i} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: USER_TYPES.includes(e.type) ? 'var(--muted)' : 'var(--green)' }}>{TYPE_LABEL[e.type] || e.type}</span>
                    <span className="muted" style={{ fontSize: 11, flex: 'none' }}>{thDate(e.ts)} {thTime(e.ts)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.4 }}>{e.note}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>โดย {e.by}</div>
                </div>
              ))}
              {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่มีรายการในตัวกรองนี้</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PendingRow({ u, onApprove, roleLabelOf }: { u: User; onApprove: () => void; roleLabelOf: (r: Role) => string }) {
  return (
    <div style={{ padding: '12px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{u.name}</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>@{u.username} · {u.dept} · สมัครเป็น{roleLabelOf(u.role)}</div>
      </div>
      <button onClick={onApprove} style={{ flex: 'none', border: 0, background: 'var(--green)', color: '#fff', padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>อนุมัติ</button>
    </div>
  );
}
