import { useState } from 'react'
import Layout from '../components/Layout'
import MedicationPicker from '../components/MedicationPicker'
import LotPicker from '../components/LotPicker'
import QtyStepper from '../components/QtyStepper'
import HighAlertConfirm from '../components/HighAlertConfirm'
import { useCollection } from '../hooks/useCollection'
import { medicationsQuery } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { transferToFloor } from '../lib/api'
import { TransferIcon, CheckIcon } from '../components/Icons'

export default function TransferToFloor() {
  const { profile } = useAuth()
  const { data: medications } = useCollection(medicationsQuery())

  const [medication, setMedication] = useState(null)
  const [lot, setLot] = useState(null)
  const [qty, setQty] = useState('')
  const [haConfirmed, setHaConfirmed] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  function handleMedicationChange(med) {
    setMedication(med)
    setLot(null)
    setQty('')
    setHaConfirmed(false)
    setSuccess(null)
  }

  const needsHaConfirm = medication?.is_high_alert && !haConfirmed
  const canSubmit =
    medication && lot && Number(qty) > 0 && Number(qty) <= lot.qty && !needsHaConfirm && !submitting

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await transferToFloor(profile, { medication, lot, qty, highAlertConfirmed: haConfirmed, note })
      setSuccess({ medName: medication.generic_name, qty, lotNo: lot.lot_no })
      handleMedicationChange(null)
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout>
      <h2 className="flex-row"><TransferIcon width={22} height={22} /> โอนยาไปหน้างานจ่ายยา</h2>
      <p className="text-muted text-sm">เติมยาจาก Substock ไปหน้างาน — ระบบแนะนำล็อตตาม FEFO อัตโนมัติ</p>

      {success && (
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <strong className="flex-row"><CheckIcon width={16} height={16} color="var(--success)" /> โอนสำเร็จ</strong>
          <p className="mt-0">{success.medName} • ล็อต {success.lotNo} • จำนวน {success.qty}</p>
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

            <div className="field">
              <label>เลือกล็อต (แนะนำล็อตใกล้หมดอายุสุดตาม FEFO)</label>
              <LotPicker medicationId={medication.id} value={lot} onChange={setLot} />
            </div>

            {lot && (
              <>
                <div className="field">
                  <label>จำนวนที่โอน ({medication.unit_issue || 'หน่วย'}) — คงเหลือในล็อต {lot.qty}</label>
                  <QtyStepper value={qty} onChange={setQty} min={0} max={lot.qty} unit={medication.unit_issue} />
                  {Number(qty) > lot.qty && <p className="error-text">จำนวนเกินยอดคงเหลือในล็อตนี้</p>}
                </div>

                <div className="field">
                  <label htmlFor="note">หมายเหตุ (ถ้ามี)</label>
                  <textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>

                {error && <p className="error-text">{error}</p>}

                <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
                  {submitting ? 'กำลังบันทึก…' : needsHaConfirm ? 'ต้องสแกนยืนยัน High-alert ก่อน' : 'ยืนยันโอนยา'}
                </button>
              </>
            )}
          </>
        )}
      </form>
    </Layout>
  )
}
