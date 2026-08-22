import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { useStockAlerts } from '../hooks/useStockAlerts'
import { usePendingWrites } from '../hooks/usePendingWrites'
import { formatThaiDate } from '../lib/dates'
import { ROLES } from '../lib/constants'
import {
  InboxIcon,
  TransferIcon,
  PillIcon,
  EditIcon,
  ReportIcon,
  AlertIcon,
  PackageIcon,
  ClockIcon
} from '../components/Icons'

const TILES = [
  { to: '/receive', label: 'รับยาเข้า Substock', icon: InboxIcon, roles: [ROLES.PHARMACIST, ROLES.ADMIN] },
  { to: '/transfer', label: 'โอนไปหน้างาน', icon: TransferIcon, roles: [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN] },
  { to: '/dispense', label: 'จ่ายยาผู้ป่วย', icon: PillIcon, roles: [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN] },
  { to: '/adjust', label: 'คืนยา/ปรับยอด', icon: EditIcon, roles: [ROLES.PHARMACIST, ROLES.TECH, ROLES.ADMIN] },
  { to: '/reports', label: 'รายงาน/Export', icon: ReportIcon, roles: [ROLES.PHARMACIST, ROLES.ADMIN] }
]

export default function Dashboard() {
  const { profile } = useAuth()
  const alerts = useStockAlerts()
  const pending = usePendingWrites()

  const tiles = TILES.filter((t) => t.roles.includes(profile.role))
  const substockCount = alerts.substockByMed.size
  const floorCount = alerts.floorByMed.size

  return (
    <Layout>
      <h2>สวัสดี, {profile.name} 👋</h2>
      <p className="text-muted">ภาพรวมสต็อกยา ณ วันนี้</p>

      {pending > 0 && (
        <div className="pending-banner">
          <ClockIcon width={16} height={16} /> มี {pending} รายการที่บันทึกไว้ตอนออฟไลน์ กำลังรอซิงค์ขึ้นระบบ
        </div>
      )}

      <div className="card-grid">
        <div className="stat-card">
          <div className="stat-card__label"><PackageIcon width={14} height={14} /> รายการยาใน Substock</div>
          <div className="stat-card__value">{substockCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label"><PackageIcon width={14} height={14} /> รายการยาหน้างาน</div>
          <div className="stat-card__value">{floorCount}</div>
        </div>
        <div className={`stat-card ${alerts.reorderSubstock.length + alerts.reorderFloor.length > 0 ? 'stat-card--warning' : ''}`}>
          <div className="stat-card__label">ต่ำกว่าจุดสั่งซื้อ</div>
          <div className="stat-card__value">{alerts.reorderSubstock.length + alerts.reorderFloor.length}</div>
        </div>
        <div className={`stat-card ${alerts.expiringSoon.length + alerts.expiredLots.length > 0 ? 'stat-card--danger' : ''}`}>
          <div className="stat-card__label">ใกล้หมดอายุ/หมดอายุ</div>
          <div className="stat-card__value">{alerts.expiringSoon.length + alerts.expiredLots.length}</div>
        </div>
      </div>

      <div className="section-title">ทางลัด</div>
      <div className="card-grid">
        {tiles.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="btn-tile">
            <Icon />
            {label}
          </Link>
        ))}
      </div>

      <div className="section-title">
        <span className="flex-row"><AlertIcon width={16} height={16} /> รายการแจ้งเตือน</span>
      </div>

      {alerts.loading && <p className="text-muted text-sm">กำลังโหลด…</p>}

      {!alerts.loading && alerts.totalAlerts === 0 && (
        <div className="card empty-state">✅ ไม่มีรายการแจ้งเตือนในขณะนี้</div>
      )}

      {alerts.expiredLots.length > 0 && (
        <div className="card">
          <div className="flex-between">
            <strong className="text-danger">ยาหมดอายุแล้ว ({alerts.expiredLots.length})</strong>
          </div>
          {alerts.expiredLots.slice(0, 5).map((row) => (
            <div className="list-row" key={row.id}>
              <div>
                <div className="list-row__title">{alerts.medById.get(row.medication_id)?.generic_name || row.medication_id}</div>
                <div className="list-row__sub">ล็อต {row.lot_no} • หมดอายุ {formatThaiDate(row.exp_date)} • คงเหลือ {row.qty}</div>
              </div>
              <span className="badge badge-danger">หมดอายุแล้ว</span>
            </div>
          ))}
        </div>
      )}

      {alerts.expiringSoon.length > 0 && (
        <div className="card">
          <strong>ยาใกล้หมดอายุ ({alerts.expiringSoon.length})</strong>
          {alerts.expiringSoon.slice(0, 8).map((row) => (
            <div className="list-row" key={row.id}>
              <div>
                <div className="list-row__title">{alerts.medById.get(row.medication_id)?.generic_name || row.medication_id}</div>
                <div className="list-row__sub">ล็อต {row.lot_no} • คงเหลือ {row.qty}</div>
              </div>
              <span className="badge badge-warning">อีก {row.daysLeft} วัน</span>
            </div>
          ))}
        </div>
      )}

      {alerts.reorderSubstock.length > 0 && (
        <div className="card">
          <strong>Substock ต่ำกว่าจุดสั่งซื้อ ({alerts.reorderSubstock.length})</strong>
          {alerts.reorderSubstock.slice(0, 8).map((m) => (
            <div className="list-row" key={m.id}>
              <div className="list-row__title">{m.generic_name}</div>
              <span className="badge badge-warning">
                คงเหลือ {alerts.substockByMed.get(m.id) || 0} / จุดสั่งซื้อ {m.reorder_point_substock}
              </span>
            </div>
          ))}
        </div>
      )}

      {alerts.reorderFloor.length > 0 && (
        <div className="card">
          <strong>หน้างานจ่ายยาต่ำกว่า par level ({alerts.reorderFloor.length})</strong>
          {alerts.reorderFloor.slice(0, 8).map((m) => (
            <div className="list-row" key={m.id}>
              <div className="list-row__title">{m.generic_name}</div>
              <span className="badge badge-warning">
                คงเหลือ {alerts.floorByMed.get(m.id) || 0} / จุดสั่งซื้อ {m.reorder_point_floor}
              </span>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}
