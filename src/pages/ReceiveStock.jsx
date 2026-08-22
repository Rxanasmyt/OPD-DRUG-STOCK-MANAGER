import { useState } from 'react'
import Layout from '../components/Layout'
import MedicationPicker from '../components/MedicationPicker'
import QtyStepper from '../components/QtyStepper'
import { useCollection } from '../hooks/useCollection'
import { medicationsQuery } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { receiveStock } from '../lib/api'
import { CheckIcon, InboxIcon } from '../components/Icons'
import { formatThaiDateTime } from '../lib/dates'

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function ReceiveStock() {
  const { profile } = useAuth()
  const { data: medications } = useCollection(medicationsQuery())

  const [medication, setMedication] = useState(null)
  const [lotNo, setLotNo] = useState('')
  const [expDate, setExpDate] = useState('')
  const [qty, setQty] = useState('')
  const [requisitionNo, setRequisitionNo] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState([])

  const canSubmit = medication && lotNo.trim() && expDate && Number(qty) > 0 && !submitting

  function resetForm(keepMedication = true) {
    setLotNo('')
    setExpDate('')
    setQty('')
    setRequisitionNo('')
    setNote('')
    if (!keepMedication) setMedication(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await receiveStock(profile, {
        medication,
        lotNo: lotNo.trim(),
        expDate,
        receivedDate: todayISO(),
        qty,
        requisitionNo,
        note
      })
      setRecent((r) => [
        { id: `${Date.now()}`, medName: medication.generic_name, lotNo, qty, time: new Date() },
        ...r
      ].slice(0, 5))
      resetForm(true)
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout>
      <h2 className="flex-row"><InboxIcon width={22} height={22} /> รับยาเข้า Substock</h2>
      <p className="text-muted text-sm">บันทึกยาที่เบิกมาจากคลังยาใหญ่ตามใบเบิก</p>

      <form className="card" onSubmit={handleSubmit}>
        <div className="field">
          <label>เลือกยา</label>
          <MedicationPicker medications={medications} value={medication} onChange={setMedication} />
        </div>

        {medication && (
          <>
            <div className="field">
              <label htmlFor="lotNo">เลขที่ล็อต (Lot No.)</label>
              <input id="lotNo" className="input" value={lotNo} onChange={(e) => setLotNo(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="expDate">วันหมดอายุ</label>
              <input
                id="expDate"
                type="date"
                className="input"
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label>จำนวน ({medication.unit_issue || 'หน่วย'})</label>
              <QtyStepper value={qty} onChange={setQty} step={1} min={0} unit={medication.unit_issue} />
            </div>

            <div className="field">
              <label htmlFor="reqNo">เลขที่ใบเบิกจากคลังใหญ่ (ถ้ามี)</label>
              <input id="reqNo" className="input" value={requisitionNo} onChange={(e) => setRequisitionNo(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="note">หมายเหตุ</label>
              <textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {submitting ? 'กำลังบันทึก…' : 'บันทึกรับยาเข้า Substock'}
            </button>
          </>
        )}
      </form>

      {recent.length > 0 && (
        <div className="card">
          <strong className="flex-row"><CheckIcon width={16} height={16} color="var(--success)" /> บันทึกล่าสุดในรอบนี้</strong>
          {recent.map((r) => (
            <div className="list-row" key={r.id}>
              <div>
                <div className="list-row__title">{r.medName}</div>
                <div className="list-row__sub">ล็อต {r.lotNo} • {formatThaiDateTime(r.time)}</div>
              </div>
              <span className="badge badge-success">+{r.qty}</span>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}
