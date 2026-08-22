import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

const ERROR_MESSAGES = {
  'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
  'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/wrong-password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/user-not-found': 'ไม่พบบัญชีนี้ในระบบ',
  'auth/email-already-in-use': 'อีเมลนี้ถูกใช้สมัครแล้ว',
  'auth/weak-password': 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'
}

export default function Login() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const online = useOnlineStatus()

  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
      } else {
        await signUp(name.trim(), email.trim(), password)
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(ERROR_MESSAGES[err.code] || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="center-page">
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40 }}>💊</div>
          <h2 className="mt-0">จัดการสต็อกยา OPD</h2>
          <p className="text-muted text-sm">Substock ห้องยา → หน้างานจ่ายยา</p>
        </div>

        {!online && (
          <div className="pending-banner">ขณะนี้ออฟไลน์ — การเข้าสู่ระบบต้องใช้อินเทอร์เน็ตอย่างน้อยครั้งแรก</div>
        )}

        <div className="tabs">
          <button type="button" className={mode === 'signin' ? 'is-active' : ''} onClick={() => setMode('signin')}>
            เข้าสู่ระบบ
          </button>
          <button type="button" className={mode === 'signup' ? 'is-active' : ''} onClick={() => setMode('signup')}>
            สมัครใช้งาน
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="name">ชื่อ-นามสกุล</label>
              <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">อีเมล</label>
            <input
              id="email"
              type="email"
              className="input"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="password">รหัสผ่าน</label>
            <input
              id="password"
              type="password"
              className="input"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting || !online}>
            {submitting ? 'กำลังดำเนินการ…' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน'}
          </button>
        </form>

        {mode === 'signup' && (
          <p className="text-muted text-sm" style={{ marginTop: 14, textAlign: 'center' }}>
            หลังสมัคร ต้องรอผู้ดูแลระบบอนุมัติสิทธิ์การใช้งานก่อนจึงจะเข้าใช้ระบบได้
          </p>
        )}
      </div>
    </div>
  )
}
