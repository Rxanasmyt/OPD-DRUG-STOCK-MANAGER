import { useApp } from '../store/AppContext';
import { thDate, thTime } from '../utils/format';
import type { AdminTab, AuditFilter, Role, User } from '../types';

const ADMIN_TABS: [AdminTab, string][] = [['users', 'ผู้ใช้งาน'], ['audit', 'Audit log']];
const ROLES: Role[] = ['pharm', 'tech', 'admin'];
const ROLE_COLOR: Record<Role, string> = { admin: 'var(--red)', pharm: 'var(--green)', tech: 'var(--amber-ink)' };
const ROLE_BG: Record<Role, string> = { admin: 'var(--red-bg)', pharm: 'var(--green-tint)', tech: 'var(--amber-bg)' };
function initialsOf(name: string): string {
  const cleaned = name.replace(/^(ภญ\.|ภก\.|จพ\.|กภ\.|นาง|นางสาว|นาย)\s*/, '').trim();
  return (cleaned[0] || name[0] || '?').toUpperCase();
}
const AUDIT_FILTERS: [AuditFilter, string][] = [['all', 'ทั้งหมด'], ['users', 'บัญชีผู้ใช้'], ['stock', 'สต็อก/ธุรกรรม']];
const USER_TYPES = ['login', 'user_registered', 'user_approved', 'user_role_changed', 'user_status_changed'];
const TYPE_LABEL: Record<string, string> = {
  login: 'เข้าสู่ระบบ', user_registered: 'สมัครสมาชิก', user_approved: 'อนุมัติบัญชี', user_role_changed: 'เปลี่ยนบทบาท', user_status_changed: 'เปิด/ปิดบัญชี', par_updated: 'ปรับ par level', qr_manual: 'กรอกรหัส QR ด้วยมือ',
  med_added: 'เพิ่มยาใหม่', med_edited: 'แก้ไขข้อมูลยา', med_status_changed: 'เปิด/ปิดใช้งานยา', med_deleted: 'ลบยาถาวร',
  receive_from_central: 'รับเข้า substock', receive_pending: 'รับเข้า (รออนุมัติ)', receive_rejected: 'ปฏิเสธคำขอรับเข้า', transfer_to_floor: 'เติมหน้างาน',
  adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'ยาหมดอายุ', count: 'นับสต็อกหน้างาน', reconcile_hosxp: 'นำเข้า HOSxP',
  ward_move_out: 'ย้ายชั้นวาง (ต้นทาง)', ward_move_in: 'ย้ายชั้นวาง (ปลายทาง)',
};

export default function AdminScreen() {
  const {
    state, setAdminTab, setAuditFilter, setUserRole, toggleUserActive, exportAudit, roleLabelOf,
    setHistoryFrom, setHistoryTo, searchHistory, clearHistorySearch,
  } = useApp();
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  const pending = state.users.filter((u) => !u.active).sort((a, b) => b.createdAt - a.createdAt);
  const approved = state.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  const countByRole = (r: Role) => approved.filter((u) => u.role === r).length;

  // The live subscriptions only carry the most recent 300 (kept small on purpose, for a
  // real-time "recent activity" feed) — a date-range search below queries Firestore directly
  // instead, so any point in history is always reachable, not just the last ~300 events.
  const isHistory = state.historyResults !== null;
  const liveEntries = [
    ...state.authLog,
    ...state.txs.map((x) => ({ type: x.type, by: x.by, ts: x.ts, note: (x.name ? x.name + ' — ' : '') + (x.note || '') + (x.qty != null ? ' (' + (x.qty > 0 ? '+' : '') + x.qty + ' ' + (x.unit || '') + ')' : '') })),
  ];
  const baseEntries = isHistory ? state.historyResults! : liveEntries;
  const filtered = baseEntries
    .filter((e) => (state.auditFilter === 'all' ? true : state.auditFilter === 'users' ? USER_TYPES.includes(e.type) : !USER_TYPES.includes(e.type)))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, isHistory ? 300 : 80);

  return (
    <div style={{ animation: 'fade .18s' }}>
      <div style={{ display: 'flex', gap: 7, padding: '12px 14px 10px', overflowX: 'auto', position: 'sticky', top: 0, zIndex: 2 }} className="sticky-bar">
        {ADMIN_TABS.map(([t, label]) => (
          <button key={t} className="chip" style={{ ...chip(state.adminTab === t), minHeight: 38 }} onClick={() => setAdminTab(t)}>
            {label}{t === 'users' && pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
        ))}
      </div>

      <div style={{ padding: '12px 14px 24px' }}>
        {state.adminTab === 'users' && (
          <>
            <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
              {(['admin', 'pharm', 'tech'] as Role[]).map((r) => (
                <div key={r} className="card stat-tile" style={{ padding: '12px 13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span className="muted" style={{ fontSize: 12 }}>{roleLabelOf(r)}</span>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: ROLE_COLOR[r], flex: 'none' }} />
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: ROLE_COLOR[r] }}>{countByRole(r)}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>บัญชี</div>
                </div>
              ))}
              <div className="card stat-tile" style={{ padding: '12px 13px' }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 3 }}>ทั้งหมด</div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{approved.length}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>บัญชีที่ใช้งานอยู่</div>
              </div>
            </div>

            {pending.length > 0 && (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px', color: 'var(--amber-ink)' }}>รออนุมัติ ({pending.length})</div>
                <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 16, borderColor: 'var(--amber)' }}>
                  {pending.map((u) => <PendingRow key={u.id} u={u} onApprove={() => toggleUserActive(u.id)} roleLabelOf={roleLabelOf} />)}
                </div>
              </>
            )}

            <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px' }}>บัญชีผู้ใช้งานทั้งหมด ({approved.length})</div>
            <div className="card stagger" style={{ overflow: 'hidden' }}>
              {approved.map((u) => {
                const isMe = u.id === state.myUid;
                return (
                  <div key={u.id} style={{ padding: '12px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: ROLE_BG[u.role], color: ROLE_COLOR[u.role], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, fontWeight: 700, flex: 'none' }}>
                        {initialsOf(u.name)}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                          {isMe && <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--green)', background: 'var(--green-tint)', padding: '2px 7px', borderRadius: 20 }}>คุณ</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>@{u.username} · {u.dept}</div>
                      </div>
                      <span style={{ flex: 'none', fontSize: 10.5, color: 'var(--green)', textAlign: 'right' }}>
                        {u.lastLogin ? thDate(u.lastLogin) : 'ยังไม่เคยเข้าระบบ'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                      {ROLES.map((r) => {
                        const active = u.role === r;
                        return <button key={r} onClick={() => setUserRole(u.id, r)} style={{ flex: 1, border: active ? '1px solid ' + ROLE_COLOR[r] : '1px solid var(--border)', background: active ? ROLE_BG[r] : 'var(--bg-card)', color: active ? ROLE_COLOR[r] : 'var(--ink)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>{roleLabelOf(r)}</button>;
                      })}
                      <button onClick={() => toggleUserActive(u.id)} title="ปิดใช้งานบัญชี" style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--red)', width: 38, height: 38, borderRadius: 9, fontSize: 15 }}>⏻</button>
                    </div>
                  </div>
                );
              })}
              {approved.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีผู้ใช้งานที่อนุมัติแล้ว</div>}
            </div>
          </>
        )}

        {state.adminTab === 'audit' && (
          <>
            <div className="card" style={{ padding: 12, marginBottom: 13 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>ค้นหาย้อนหลังตามช่วงวันที่</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 9 }}>รายการล่าสุดด้านล่างแสดงเฉพาะ ~300 รายการล่าสุดเพื่อความไว — ค้นหาช่วงวันที่เพื่อดูรายการเก่ากว่านั้นได้เสมอ ไม่ว่าจะผ่านมานานแค่ไหน</div>
              <div className="grid-2" style={{ marginBottom: 9 }}>
                <label>
                  <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
                  <input type="date" value={state.historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 13, minHeight: 40 }} />
                </label>
                <label>
                  <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
                  <input type="date" value={state.historyTo} onChange={(e) => setHistoryTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 13, minHeight: 40 }} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={searchHistory} disabled={state.historyLoading} className="btn-primary" style={{ flex: 1, padding: 10, borderRadius: 9, fontSize: 13, fontWeight: 600, minHeight: 40 }}>
                  {state.historyLoading ? 'กำลังค้นหา…' : 'ค้นหา'}
                </button>
                {isHistory && (
                  <button onClick={clearHistorySearch} style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', padding: '10px 14px', borderRadius: 9, fontSize: 13, minHeight: 40 }}>กลับไปดูล่าสุด</button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 7, marginBottom: 11, overflowX: 'auto', paddingBottom: 2 }}>
              {AUDIT_FILTERS.map(([f, label]) => (
                <button key={f} className="chip" style={chip(state.auditFilter === f)} onClick={() => setAuditFilter(f)}>{label}</button>
              ))}
            </div>
            <button onClick={exportAudit} className="btn-outline" style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 14, fontWeight: 600, minHeight: 46, marginBottom: 12 }}>↓ Export CSV — audit_log.csv (ประวัติทั้งหมด)</button>
            {isHistory && (
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 9 }}>ผลค้นหา {thDate(new Date(state.historyFrom).getTime())} – {thDate(new Date(state.historyTo).getTime())} · {filtered.length} รายการ{filtered.length === 300 ? '+ (แสดงสูงสุด 300 รายการ ลองย่อช่วงวันที่)' : ''}</div>
            )}
            <div className="card stagger" style={{ overflow: 'hidden' }}>
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
              {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>{isHistory ? 'ไม่มีรายการในช่วงวันที่นี้' : 'ไม่มีรายการในตัวกรองนี้'}</div>}
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
