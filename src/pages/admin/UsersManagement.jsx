import { useState } from 'react'
import Layout from '../../components/Layout'
import { useCollection } from '../../hooks/useCollection'
import { usersQuery } from '../../lib/queries'
import { updateUserProfile } from '../../lib/api'
import { ROLES, ROLE_LABELS } from '../../lib/constants'
import { UsersIcon } from '../../components/Icons'
import { useAuth } from '../../contexts/AuthContext'

export default function UsersManagement() {
  const { user: currentUser } = useAuth()
  const { data: users, loading } = useCollection(usersQuery())
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')

  async function handleChange(u, patch) {
    setSavingId(u.id)
    setError('')
    try {
      await updateUserProfile(u.id, patch)
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingId(null)
    }
  }

  const pending = users.filter((u) => !u.active || !u.role)
  const approved = users.filter((u) => u.active && u.role)

  return (
    <Layout wide>
      <h2 className="flex-row"><UsersIcon width={22} height={22} /> จัดการผู้ใช้</h2>
      <p className="text-muted text-sm">อนุมัติบัญชีใหม่และกำหนดบทบาทผู้ใช้งาน</p>
      {error && <p className="error-text">{error}</p>}

      {pending.length > 0 && (
        <>
          <div className="section-title">รอการอนุมัติ ({pending.length})</div>
          <div className="card">
            {pending.map((u) => (
              <UserRow key={u.id} u={u} onChange={handleChange} saving={savingId === u.id} isSelf={u.id === currentUser?.uid} pendingApproval />
            ))}
          </div>
        </>
      )}

      <div className="section-title">ผู้ใช้ทั้งหมด {loading ? '' : `(${approved.length})`}</div>
      <div className="card">
        {approved.map((u) => (
          <UserRow key={u.id} u={u} onChange={handleChange} saving={savingId === u.id} isSelf={u.id === currentUser?.uid} />
        ))}
        {!loading && users.length === 0 && <div className="empty-state">ยังไม่มีผู้ใช้ในระบบ</div>}
      </div>
    </Layout>
  )
}

function UserRow({ u, onChange, saving, isSelf, pendingApproval }) {
  return (
    <div className="list-row" style={{ flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px' }}>
        <div className="list-row__title">
          {u.name} {isSelf && <span className="badge badge-info">คุณ</span>}
        </div>
        <div className="list-row__sub">{u.email} {u.department && `• ${u.department}`}</div>
      </div>
      <div className="flex-row" style={{ flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ minHeight: 40, width: 160 }}
          value={u.role || ''}
          disabled={saving}
          onChange={(e) => onChange(u, { role: e.target.value || null })}
        >
          <option value="">ยังไม่กำหนด</option>
          {Object.values(ROLES).map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <button
          type="button"
          className={`btn btn-sm ${u.active ? 'btn-secondary' : 'btn-primary'}`}
          disabled={saving || (pendingApproval && !u.role)}
          onClick={() => onChange(u, { active: !u.active })}
        >
          {u.active ? 'ระงับการใช้งาน' : 'อนุมัติ'}
        </button>
      </div>
    </div>
  )
}
