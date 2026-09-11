import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { thDate, thTime } from '../utils/format';
import type { AdminTab, AuditFilter, Role, User } from '../types';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { QrCode } from '../components/QrCode';

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
  stock_ledger_reset: 'รีเซ็ตบัตรสต็อกยาทุกตัว',
  quantity_reset: 'รีเซ็ตจำนวนยาทุกตัวเป็น 0',
};
// commitCount (floor) and commitSubCount (substock) both log type:'count' — TYPE_LABEL alone
// can't tell them apart (one key, one label), so this reads the row's loc too, the same
// disambiguator fetchSubstockLedger's SUBSTOCK_LEDGER_TYPES filter uses for the same reason.
function typeLabelOf(e: { type: string; loc?: string }): string {
  if (e.type === 'count' && e.loc === 'substock') return 'นับสต็อก substock';
  return TYPE_LABEL[e.type] || e.type;
}

// The app has no URL-based routing (see App.tsx — `screen`/`authMode` are plain in-memory
// state, not route params), so this can only ever land someone on the login screen, not
// directly on its "สมัครสมาชิก" tab. Still saves a new hire from having to be told/type the
// URL by hand, which — going by real deployments starting with exactly one lone admin account
// (see this screen's own empty เภสัชกร/จพ.เภสัชกรรม counts) — is the actual first hurdle to
// the rest of the team ever showing up here at all. Derived at runtime (origin + Vite's own
// BASE_URL, the same base vite.config.ts computes for GitHub Pages) rather than hardcoded, so
// it stays correct if this is ever hosted somewhere else.
const APP_URL = window.location.origin + import.meta.env.BASE_URL;

export default function AdminScreen() {
  const {
    state, setAdminTab, setAuditFilter, setUserRole, toggleUserActive, exportAudit, roleLabelOf, toast,
    setHistoryFrom, setHistoryTo, searchHistory, clearHistorySearch, resetAllStockLedgers, resetAllQuantities,
  } = useApp();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      toast('คัดลอกลิงก์แล้ว — ส่งให้เจ้าหน้าที่ใหม่ได้เลย');
    } catch {
      toast('คัดลอกไม่สำเร็จ — คัดลอกลิงก์ด้านบนด้วยตัวเองแทน');
    }
  };

  const pending = state.users.filter((u) => !u.active).sort((a, b) => b.createdAt - a.createdAt);
  const approvedAll = state.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  const countByRole = (r: Role) => approvedAll.filter((u) => u.role === r).length;
  // Search only narrows the "ทั้งหมด" list below — the pending queue and the 4 role-count
  // tiles above always reflect everyone, so approving/reviewing someone waiting never
  // depends on first clearing whatever was typed into this box.
  const uq = userQuery.trim().toLowerCase();
  const approved = uq ? approvedAll.filter((u) => u.name.toLowerCase().includes(uq) || u.username.toLowerCase().includes(uq)) : approvedAll;

  // The live subscriptions only carry the most recent 300 (kept small on purpose, for a
  // real-time "recent activity" feed) — a date-range search below queries Firestore directly
  // instead, so any point in history is always reachable, not just the last ~300 events.
  const isHistory = state.historyResults !== null;
  const liveEntries = [
    ...state.authLog,
    ...state.txs.map((x) => ({ type: x.type, by: x.by, ts: x.ts, loc: x.loc, note: (x.name ? x.name + ' — ' : '') + (x.note || '') + (x.qty != null ? ' (' + (x.qty > 0 ? '+' : '') + x.qty + ' ' + (x.unit || '') + ')' : '') })),
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
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{approvedAll.length}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>บัญชีที่ใช้งานอยู่</div>
              </div>
            </div>

            {/* ชวนทีมเข้าระบบ — ก่อนหน้านี้ไม่มีทางไหนในแอพช่วยชวนคนอื่นเข้าระบบเลยนอกจากบอก URL
                ปากเปล่า ปุ่มนี้ให้ลิงก์คัดลอกได้ + QR ให้สแกนตรงจากมือถือ ไปจบที่หน้า login เดิม
                (ยังต้องกดแท็บ "สมัครสมาชิก" เอง — แอพนี้ไม่มี URL routing ให้ลิงก์ไปหน้าย่อยตรงๆ)
                แต่ตัดขั้นตอน "ต้องรู้/พิมพ์ URL เอง" ออกไปได้ */}
            <div className="card" style={{ padding: 13, marginBottom: 16 }}>
              <button
                onClick={() => setInviteOpen((o) => !o)}
                style={{ width: '100%', border: 0, background: 'transparent', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: 0 }}
              >
                <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--green-tint)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flex: 'none' }}>👥</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>เชิญผู้ใช้ใหม่</span>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 1 }}>คัดลอกลิงก์หรือให้สแกน QR ไปหน้าสมัครสมาชิก</span>
                </span>
                <span aria-hidden="true" style={{ color: 'var(--muted)', fontSize: 13, flex: 'none' }}>{inviteOpen ? '▲' : '▾'}</span>
              </button>
              {inviteOpen && (
                <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--border-soft)', display: 'flex', gap: 13, alignItems: 'center', animation: 'fade .18s var(--ease-out)' }}>
                  <div style={{ flex: 'none', padding: 6, background: '#fff', borderRadius: 8, border: '1px solid var(--border-soft)' }}>
                    <QrCode value={APP_URL} size={84} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 8 }}>
                      ให้เจ้าหน้าที่ใหม่สแกน QR นี้ หรือเปิดลิงก์ด้านล่าง แล้วกดแท็บ "สมัครสมาชิก" — สมัครแล้วต้องรอเภสัชกร/Admin อนุมัติและกำหนดบทบาทก่อนจึงเข้าใช้งานได้
                    </div>
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                      <code style={{ flex: '1 1 auto', minWidth: 0, fontSize: 11, background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '7px 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{APP_URL}</code>
                      <button onClick={copyInviteLink} style={{ flex: 'none', border: 0, background: 'var(--green)', color: '#fff', padding: '8px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 34 }}>คัดลอกลิงก์</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {pending.length > 0 && (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px', color: 'var(--amber-ink)' }}>รออนุมัติ ({pending.length})</div>
                <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 16, borderColor: 'var(--amber)' }}>
                  {pending.map((u) => <PendingRow key={u.id} u={u} onApprove={() => toggleUserActive(u.id)} roleLabelOf={roleLabelOf} />)}
                </div>
              </>
            )}

            <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px' }}>
              บัญชีผู้ใช้งานทั้งหมด ({approvedAll.length}{uq ? ` · พบ ${approved.length}` : ''})
            </div>
            {/* Only worth showing once the list is actually long enough to need it — a single
                admin account (or a small handful) has nothing to search for, and an empty
                search box above one row would just be visual noise on day one. */}
            {approvedAll.length > 5 && (
              <SearchInput value={userQuery} onChange={setUserQuery} placeholder="ค้นหาชื่อหรือ username" style={{ marginBottom: 9 }} />
            )}
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
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                      {ROLES.map((r) => {
                        const active = u.role === r;
                        return <button key={r} onClick={() => setUserRole(u.id, r)} style={{ flex: '1 1 76px', border: active ? '1px solid ' + ROLE_COLOR[r] : '1px solid var(--border)', background: active ? ROLE_BG[r] : 'var(--bg-card)', color: active ? ROLE_COLOR[r] : 'var(--ink)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>{roleLabelOf(r)}</button>;
                      })}
                      {/* Bug fix (real-world confusion): a bare "⏻" icon has no visible label on
                          mobile — title/tooltip only shows on hover, which a touchscreen never
                          triggers — so this destructive-ish action (deactivates someone else's
                          account) used to be unreadable at a glance. Text label now, not just
                          an icon; aria-label kept for screen readers. */}
                      <button onClick={() => toggleUserActive(u.id)} title="ปิดใช้งานบัญชี" aria-label={'ปิดใช้งานบัญชี ' + u.name} style={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--red)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                        <span aria-hidden="true">⏻</span> ปิดใช้งานบัญชี
                      </button>
                    </div>
                  </div>
                );
              })}
              {approved.length === 0 && (
                <EmptyState icon="👤" title={uq ? 'ไม่พบผู้ใช้ที่ค้นหา' : 'ยังไม่มีผู้ใช้งานที่อนุมัติแล้ว'} sub={uq ? 'ลองพิมพ์ชื่อหรือ username แบบสั้นลง' : undefined} />
              )}
            </div>

            {/* Admin-only, sits apart from the routine account-management UI above (own red
                heading, own red-bordered cards) so it reads as a distinct, dangerous category
                rather than just another row in the list — the actual double-confirmation
                (confirmAsync + a typed "RESET") lives in each action itself, AppContext.tsx. */}
            {state.role === 'admin' && (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 600, margin: '20px 2px 8px', color: 'var(--red)' }}>เครื่องมือระบบ — ใช้ด้วยความระมัดระวัง</div>
                <div className="card" style={{ padding: 13, borderColor: 'var(--red)', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>รีเซ็ตจำนวนยาทุกตัวเป็น 0</div>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 10 }}>
                    ตั้งยอดหน้างานของยา<b>ทุกตัวเป็น 0</b> และลบ lot ทั้งหมดใน substock (ทำให้ยอด substock เป็น 0 ไปด้วย) —
                    <b>ชื่อยา รหัส หน่วย ราคา par และชั้นวางไม่เปลี่ยนแปลง</b> เหมาะสำหรับตอนที่ยอดจำนวนในระบบยังเป็นแค่ข้อมูลตัวอย่าง
                    ยังไม่ใช่ของจริง ต้องนับสต็อกจริงแล้วกรอกใหม่ทั้งหมดหลังรีเซ็ต — ย้อนกลับไม่ได้
                  </div>
                  <button
                    onClick={resetAllQuantities}
                    disabled={!!state.busy['resetAllQuantities']}
                    style={{ width: '100%', border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, minHeight: 44, opacity: state.busy['resetAllQuantities'] ? 0.7 : 1 }}
                  >
                    {state.busy['resetAllQuantities'] ? 'กำลังรีเซ็ต…' : 'รีเซ็ตจำนวนยาทุกตัวเป็น 0'}
                  </button>
                </div>
                <div className="card" style={{ padding: 13, borderColor: 'var(--red)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>รีเซ็ตบัตรสต็อกยาทุกตัว</div>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 10 }}>
                    ลบประวัติธุรกรรม (รับเข้า/เติมหน้างาน/ปรับยอด/ตัดหมดอายุ/นำเข้า HOSxP ฯลฯ) ของยา<b>ทุกตัวถาวร</b> เพื่อเริ่มต้นระบบใหม่
                    — ยอดคงเหลือปัจจุบัน (หน้างาน/substock) จะ<b>ไม่เปลี่ยนแปลง</b> แต่บัตรสต็อก รายงาน และสถิติที่คำนวณจากประวัติจะว่างเปล่าทั้งหมด
                    ใช้เฉพาะตอนเริ่มต้นใช้งานระบบจริงครั้งแรกเท่านั้น — ย้อนกลับไม่ได้
                  </div>
                  <button
                    onClick={resetAllStockLedgers}
                    disabled={!!state.busy['resetAllStockLedgers']}
                    style={{ width: '100%', border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, minHeight: 44, opacity: state.busy['resetAllStockLedgers'] ? 0.7 : 1 }}
                  >
                    {state.busy['resetAllStockLedgers'] ? 'กำลังรีเซ็ต…' : 'รีเซ็ตบัตรสต็อกยาทุกตัว'}
                  </button>
                </div>
              </>
            )}
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
                  <input type="date" value={state.historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 16, minHeight: 40 }} />
                </label>
                <label>
                  <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
                  <input type="date" value={state.historyTo} onChange={(e) => setHistoryTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 16, minHeight: 40 }} />
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
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: USER_TYPES.includes(e.type) ? 'var(--muted)' : 'var(--green)' }}>{typeLabelOf(e)}</span>
                    <span className="muted" style={{ fontSize: 11, flex: 'none' }}>{thDate(e.ts)} {thTime(e.ts)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.4 }}>{e.note}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>โดย {e.by}</div>
                </div>
              ))}
              {filtered.length === 0 && (
                <EmptyState
                  icon="📜"
                  title={isHistory ? 'ไม่มีรายการในช่วงวันที่นี้' : 'ไม่มีรายการในตัวกรองนี้'}
                  sub={isHistory ? 'ลองขยายช่วงวันที่ให้กว้างขึ้น' : 'ลองสลับตัวกรองด้านบน หรือค้นหาย้อนหลังตามช่วงวันที่'}
                />
              )}
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
