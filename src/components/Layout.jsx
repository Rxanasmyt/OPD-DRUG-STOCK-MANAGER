import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, ROLE_LABELS } from '../lib/constants'
import SyncStatusBadge from './SyncStatusBadge'
import {
  HomeIcon,
  InboxIcon,
  TransferIcon,
  PillIcon,
  EditIcon,
  ReportIcon,
  SettingsIcon,
  LogoutIcon,
  UsersIcon,
  QrIcon,
  XIcon
} from './Icons'

const NAV_ITEMS = [
  { to: '/', label: 'หน้าหลัก', icon: HomeIcon, roles: [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN], exact: true },
  { to: '/receive', label: 'รับยา', icon: InboxIcon, roles: [ROLES.PHARMACIST, ROLES.ADMIN] },
  { to: '/transfer', label: 'โอนหน้างาน', icon: TransferIcon, roles: [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN] },
  { to: '/dispense', label: 'จ่ายยา', icon: PillIcon, roles: [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN] }
]

const MORE_ITEMS = [
  { to: '/adjust', label: 'คืนยา / ปรับยอด / ยาเสีย', icon: EditIcon, roles: [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN] },
  { to: '/reports', label: 'รายงาน / Export', icon: ReportIcon, roles: [ROLES.PHARMACIST, ROLES.ADMIN] },
  { to: '/admin/medications', label: 'จัดการข้อมูลยา', icon: SettingsIcon, roles: [ROLES.ADMIN, ROLES.PHARMACIST] },
  { to: '/admin/users', label: 'จัดการผู้ใช้', icon: UsersIcon, roles: [ROLES.ADMIN] },
  { to: '/admin/qr-labels', label: 'พิมพ์ QR label ยา', icon: QrIcon, roles: [ROLES.ADMIN, ROLES.PHARMACIST] }
]

export default function Layout({ children, wide = false }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  const role = profile?.role
  const visibleNav = NAV_ITEMS.filter((i) => i.roles.includes(role))
  const visibleMore = MORE_ITEMS.filter((i) => i.roles.includes(role))

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">💊 สต็อกยา OPD</span>
        <div className="flex-row">
          <SyncStatusBadge />
          <button type="button" className="btn btn-icon btn-ghost" onClick={handleSignOut} aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <LogoutIcon width={19} height={19} />
          </button>
        </div>
      </header>

      <main className={`app-main ${wide ? 'app-main--wide' : ''}`}>{children}</main>

      <nav className="bottom-nav">
        {visibleNav.map(({ to, label, icon: Icon, exact }) => (
          <NavLink key={to} to={to} end={exact} className={({ isActive }) => `bottom-nav__item ${isActive ? 'is-active' : ''}`}>
            <Icon />
            {label}
          </NavLink>
        ))}
        {visibleMore.length > 0 && (
          <button type="button" className="bottom-nav__item" onClick={() => setMoreOpen(true)}>
            <SettingsIcon />
            เพิ่มเติม
          </button>
        )}
      </nav>

      {moreOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setMoreOpen(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-sheet__header">
              <h3 className="mt-0">เมนูเพิ่มเติม</h3>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setMoreOpen(false)} aria-label="ปิด">
                <XIcon />
              </button>
            </div>
            <div className="stack">
              {visibleMore.map(({ to, label, icon: Icon }) => (
                <button
                  key={to}
                  type="button"
                  className="btn btn-secondary"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => {
                    setMoreOpen(false)
                    navigate(to)
                  }}
                >
                  <Icon width={18} height={18} /> {label}
                </button>
              ))}
            </div>
            <p className="text-muted text-sm" style={{ marginTop: 14, textAlign: 'center' }}>
              เข้าสู่ระบบในฐานะ {ROLE_LABELS[role]} • {profile?.name}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
