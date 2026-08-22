import { useState } from 'react'
import Layout from '../../components/Layout'
import { useCollection } from '../../hooks/useCollection'
import { allMedicationsQuery } from '../../lib/queries'
import { createMedication, updateMedication, setMedicationActive } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { COMMON_UNITS } from '../../lib/constants'
import { SettingsIcon, PlusIcon, XIcon, AlertIcon } from '../../components/Icons'

const emptyForm = {
  generic_name: '',
  trade_name: '',
  code: '',
  category: '',
  strength: '',
  unit_issue: 'กล่อง',
  unit_dispense: 'เม็ด',
  conversion_factor: 1,
  is_high_alert: false,
  reorder_point_substock: 0,
  reorder_point_floor: 0,
  par_level_floor: 0
}

export default function MedicationMaster() {
  const { profile } = useAuth()
  const { data: medications, loading } = useCollection(allMedicationsQuery())
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null) // medication object กำลังแก้ไข หรือ null = สร้างใหม่
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setShowForm(true)
  }
  function openEdit(m) {
    setEditing(m)
    setForm({ ...emptyForm, ...m })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        ...form,
        conversion_factor: Number(form.conversion_factor) || 1,
        reorder_point_substock: Number(form.reorder_point_substock) || 0,
        reorder_point_floor: Number(form.reorder_point_floor) || 0,
        par_level_floor: Number(form.par_level_floor) || 0
      }
      if (editing) {
        await updateMedication(editing.id, payload)
      } else {
        await createMedication(profile, payload)
      }
      setShowForm(false)
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = medications.filter((m) => {
    const q = search.toLowerCase()
    return !q || m.generic_name?.toLowerCase().includes(q) || m.trade_name?.toLowerCase().includes(q)
  })

  return (
    <Layout wide>
      <h2 className="flex-row"><SettingsIcon width={22} height={22} /> จัดการข้อมูลยา (Master Data)</h2>
      <p className="text-muted text-sm">ตั้งค่า reorder point, par level และยา high-alert</p>

      <div className="flex-row" style={{ marginBottom: 12 }}>
        <input className="input" placeholder="ค้นหายา…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
          <PlusIcon width={16} height={16} /> เพิ่มยาใหม่
        </button>
      </div>

      <div className="card">
        {loading && <p className="text-muted text-sm">กำลังโหลด…</p>}
        {!loading && filtered.length === 0 && <div className="empty-state">ไม่พบยา</div>}
        {filtered.map((m) => (
          <div className="list-row" key={m.id}>
            <div>
              <div className="list-row__title">
                {m.generic_name}
                {m.is_high_alert && <span className="badge badge-danger" style={{ marginLeft: 6 }}><AlertIcon width={11} height={11} /> High-alert</span>}
                {m.active === false && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>ปิดใช้งาน</span>}
              </div>
              <div className="list-row__sub">
                {m.trade_name} {m.strength} • Reorder substock: {m.reorder_point_substock} • floor: {m.reorder_point_floor}
              </div>
            </div>
            <div className="flex-row">
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => openEdit(m)}>แก้ไข</button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setMedicationActive(m.id, m.active === false)}
              >
                {m.active === false ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowForm(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-sheet__header">
              <h3 className="mt-0">{editing ? 'แก้ไขข้อมูลยา' : 'เพิ่มยาใหม่'}</h3>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setShowForm(false)} aria-label="ปิด"><XIcon /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="generic_name">ชื่อสามัญ (Generic name) *</label>
                <input id="generic_name" className="input" required value={form.generic_name} onChange={(e) => setForm({ ...form, generic_name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="trade_name">ชื่อการค้า</label>
                <input id="trade_name" className="input" value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
              </div>
              <div className="card-grid">
                <div className="field">
                  <label htmlFor="strength">ความแรง/ขนาด</label>
                  <input id="strength" className="input" value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="category">หมวดหมู่</label>
                  <input id="category" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                </div>
              </div>
              <div className="card-grid">
                <div className="field">
                  <label htmlFor="unit_issue">หน่วยเบิก (Substock)</label>
                  <select id="unit_issue" className="input" value={form.unit_issue} onChange={(e) => setForm({ ...form, unit_issue: e.target.value })}>
                    {COMMON_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="unit_dispense">หน่วยจ่าย (หน้างาน)</label>
                  <select id="unit_dispense" className="input" value={form.unit_dispense} onChange={(e) => setForm({ ...form, unit_dispense: e.target.value })}>
                    {COMMON_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="conversion_factor">อัตราแปลงหน่วย (1 {form.unit_issue} = กี่ {form.unit_dispense})</label>
                <input id="conversion_factor" type="number" min="1" className="input" value={form.conversion_factor} onChange={(e) => setForm({ ...form, conversion_factor: e.target.value })} />
              </div>
              <div className="card-grid">
                <div className="field">
                  <label htmlFor="rps">จุดสั่งซื้อ Substock</label>
                  <input id="rps" type="number" min="0" className="input" value={form.reorder_point_substock} onChange={(e) => setForm({ ...form, reorder_point_substock: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="rpf">จุดสั่งซื้อหน้างาน</label>
                  <input id="rpf" type="number" min="0" className="input" value={form.reorder_point_floor} onChange={(e) => setForm({ ...form, reorder_point_floor: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="par">Par level หน้างาน (เติมให้ถึงระดับนี้)</label>
                <input id="par" type="number" min="0" className="input" value={form.par_level_floor} onChange={(e) => setForm({ ...form, par_level_floor: e.target.value })} />
              </div>
              <div className="field">
                <label className="flex-row">
                  <input type="checkbox" checked={form.is_high_alert} onChange={(e) => setForm({ ...form, is_high_alert: e.target.checked })} style={{ width: 20, height: 20 }} />
                  ยา High-alert (บังคับสแกน QR ยืนยันก่อนทำรายการ)
                </label>
              </div>

              {error && <p className="error-text">{error}</p>}
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
