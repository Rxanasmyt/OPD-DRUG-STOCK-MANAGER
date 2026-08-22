import { useState } from 'react'
import Layout from '../components/Layout'
import MedicationPicker from '../components/MedicationPicker'
import QtyStepper from '../components/QtyStepper'
import HighAlertConfirm from '../components/HighAlertConfirm'
import { useCollection } from '../hooks/useCollection'
import { useDocument } from '../hooks/useDocument'
import { medicationsQuery, floorInventoryDocRef } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { dispenseToPatient } from '../lib/api'
import { PillIcon, CheckIcon } from '../components/Icons'
import { formatThaiDate } from '../lib/dates'

export default function Dispense() {
  const { profile } = useAuth()
  const { data: medications } = useCollection(medicationsQuery())

  const [medication, setMedication] = useState(null)
  const [qty, setQty] = useState('')
  const [patientRef, setPatientRef] = useState('')
  const [note, setNote] = useState('')
  const [haConfirmed, setHaConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  const { data: floorStock } = useDocument(medication ? floorInventoryDocRef(medication.id) : null, [medication?.id])
  const floorQty = floorStock?.qty || 0

  function handleMedicationChange(med) {
    setMedication(med)
    setQty('')
    setHaConfirmed(false)
    setSuccess(null)
  }

  const needsHaConfirm = medication?.is_high_alert && !haConfirmed
  const overStock = Number(qty) > floorQty
  const canSubmit = medication && Number(qty) > 0 && !needsHaConfirm && !submitting

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await dispenseToPatient(profile, { medication, qty, highAlertConfirmed: haConfirmed, note, patientRef })
      setSuccess({ medName: medication.generic_name, qty })
      handleMedicationChange(null)
      setPatientRef('')
      setNote('')
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout>
      <h2 className="flex-row"><PillIcon width={22} height={22} /> จ่ายยาให้ผู้ป่วย</h2>
      <p className="text-muted text-sm">หักยอดจากหน้างานจ่ายยา</p>

      {success && (
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <strong className="flex-row"><CheckIcon width={16} height={16} color="var(--success)" /> บันทึกจ่ายยาสำเร็จ</strong>
          <p className="mt-0">{success.medName} • จำนวน {success.qty}</p>
        </div>
      )}

      <form className="card" onSubmit={handleSubmit}>
        <div className="field">
          <label>เลือกยา</label>
          <MedicationPicker medications={medications} value={medication} onChange={handleMedicationChange} />
        </div>

        {medication && (
          <>
            <HighAlertConfirm medication={medication} confirmed={haConfirmed} onConfirmedChange={setHaConfirmed} />

            <div className="pending-banner" style={{ background: 'var(--teal-50)', borderColor: 'var(--teal-100)', color: 'var(--teal-800)' }}>
              คงเหลือหน้างานขณะนี้: {floorQty.toLocaleString('th-TH')} {medication.unit_dispense}
              {floorStock?.earliest_exp_date && ` • ล็อตใกล้หมดอายุสุด: ${formatThaiDate(floorStock.earliest_exp_date)}`}
            </div>

            <div className="field">
              <label>จำนวนที่จ่าย ({medication.unit_dispense || 'หน่วย'})</label>
              <QtyStepper value={qty} onChange={setQty} min={0} unit={medication.unit_dispense} />
              {overStock && <p className="error-text">จำนวนมากกว่ายอดคงเหลือหน้างาน — ตรวจสอบก่อนบันทึก</p>}
            </div>

            <div className="field">
              <label htmlFor="patientRef">อ้างอิงผู้ป่วย/เลขที่ใบสั่งยา (ถ้ามี)</label>
              <input id="patientRef" className="input" value={patientRef} onChange={(e) => setPatientRef(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="note">หมายเหตุ</label>
              <textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {submitting ? 'กำลังบันทึก…' : needsHaConfirm ? 'ต้องสแกนยืนยัน High-alert ก่อน' : 'ยืนยันจ่ายยา'}
            </button>
          </>
        )}
      </form>
    </Layout>
  )
}
