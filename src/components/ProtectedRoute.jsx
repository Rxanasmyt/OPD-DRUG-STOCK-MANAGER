import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ROLE_LABELS } from '../lib/constants'

/**
 * ครอบ route ที่ต้อง login (และเลือกได้ว่าต้องมี role ใดบ้าง)
 * - ยังไม่ login -> เด้งไป /login
 * - login แล้วแต่ admin ยังไม่อนุมัติ role -> หน้ารอการอนุมัติ
 * - login แล้วแต่ role ไม่ตรงสิทธิ์หน้านี้ -> หน้าไม่มีสิทธิ์
 */
export default function ProtectedRoute({ children, roles }) {
  const { user, profile, loading, isApproved } = useAuth()

  if (loading) {
    return (
      <div className="center-page">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (!isApproved) {
    return (
      <div className="center-page">
        <div className="card" style={{ textAlign: 'center' }}>
          <h3>รอการอนุมัติบัญชี</h3>
          <p className="text-muted">
            บัญชี {profile?.name || user.email} ยังไม่ได้รับสิทธิ์การใช้งาน กรุณาติดต่อผู้ดูแลระบบ (Admin) เพื่อกำหนดบทบาทผู้ใช้
          </p>
        </div>
      </div>
    )
  }

  if (roles && !roles.includes(profile.role)) {
    return (
      <div className="center-page">
        <div className="card" style={{ textAlign: 'center' }}>
          <h3>ไม่มีสิทธิ์เข้าถึงหน้านี้</h3>
          <p className="text-muted">
            หน้านี้จำกัดสิทธิ์เฉพาะ {roles.map((r) => ROLE_LABELS[r]).join(', ')} — บัญชีของคุณคือ {ROLE_LABELS[profile.role]}
          </p>
        </div>
      </div>
    )
  }

  return children
}
