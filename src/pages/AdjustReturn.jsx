import { useMemo, useState } from 'react'
import Layout from '../components/Layout'
import MedicationPicker from '../components/MedicationPicker'
import LotPicker from '../components/LotPicker'
import QtyStepper from '../components/QtyStepper'
import { useCollection } from '../hooks/useCollection'
import { medicationsQuery } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { adjustOrReturn } from '../lib/api'
import { canCreateTxType, LOCATIONS, LOCATION_LABELS, TX_TYPES } from '../lib/constants'
import { EditIcon, CheckIcon } from '../components/Icons'

const TABS = [
  { id: 'return', label: 'คืนยา' },
  { id: 'expired_waste', label: 'ยาเสีย/หมดอายุ' },
  { id: 'adjust', label: 'ปรับยอด' }
]

export default function AdjustReturn() {
  const { profile } = useAuth()
  const { data: medications } = useCollection(medicationsQuery())
  const role = profile.role

  const allowedTabs = useMemo(() => {
    const canReturn = canCreateTxType(role, TX_TYPES.RETURN_TO_SUBSTOCK) || canCreateTxType(role, TX_TYPES.RETURN_TO_CENTRAL)
    const canExpiredWaste = canCreateTxType(role, TX_TYPES.EXPIRED) || canCreateTxType(role, TX_TYPES.WASTE)
    const canAdjust = canCreateTxType(role, TX_TYPES.ADJUST)
    return TABS.filter((t) => (t.id === 'return' && canReturn) || (t.id === 'expired_waste' && canExpiredWaste) || (t.id === 'adjust' && canAdjust))
  }, [role])

  const [tab, setTab] = useState(allowedTabs[0]?.id)
  const [returnType, setReturnType] = useState(TX_TYPES.RETURN_TO_SUBSTOCK)
  const [ewType, setEwType] = useState(TX_TYPES.EXPIRED)
  const [ewLocation, setEwLocation] = useState(LOCATIONS.SUBSTOCK)
  const [adjLocation, setAdjLocation] = useState(LOCATIONS.SUBSTOCK)
  const [adjSign, setAdjSign] = useState(1)

  const [medication, setMedication] = useState(null)
  const [lot, setLot] = useState(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  function resetSelection(nextMed = null) {
    setMedication(nextMed)
    setLot(null)
    setQty('')
    setReason('')
    setNote('')
    setSuccess(null)
  }

  // สรุป config ปัจจุบันจาก tab/ตัวเลือกย่อย -> ประเภทธุรกรรม, ตำแหน่ง, ต้องเลือกล็อตไหม, โหมด LotPicker
  const config = useMemo(() => {
    if (tab === 'return') {
      if (returnType === TX_TYPES.RETURN_TO_SUBSTOCK) {
        return { type: TX_TYPES.RETURN_TO_SUBSTOCK, location: LOCATIONS.SUBSTOCK, needsLot: true, lotMode: 'all', desc: 'คืนยาจากหน้างานกลับเข้า Substock' }
      }
      return { type: TX_TYPES.RETURN_TO_CENTRAL, location: LOCATIONS.SUBSTOCK, needsLot: true, lotMode: 'fefo', desc: 'คืนยาจาก Substock กลับคลังใหญ่' }
    }
    if (tab === 'expired_waste') {
      return {
        type: ewType,
        location: ewLocation,
        needsLot: ewLocation === LOCATIONS.SUBSTOCK,
        lotMode: 'fefo',
        desc: `${ewType === TX_TYPES.EXPIRED ? 'ยาหมดอายุ' : 'ยาเสีย/แตกหัก'} ที่ ${LOCATION_LABELS[ewLocation]}`
      }
    }
    // adjust
    return {
      type: TX_TYPES.ADJUST,
      location: adjLocation,
      needsLot: adjLocation === LOCATIONS.SUBSTOCK,
      lotMode: 'all',
      desc: `ปรับยอด ${LOCATION_LABELS[adjLocation]}`
    }
  }, [tab, returnType, ewType, ewLocation, adjLocation])

  const magnitude = Number(qty) || 0
  const finalQty = tab === 'adjust' ? adjSign * magnitude : magnitude
  const canSubmit =
    medication &&
    (!config.needsLot || lot) &&
    magnitude > 0 &&
    reason.trim() &&
    !submitting

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await adjustOrReturn(profile, {
        type: config.type,
        medication,
        lot: config.needsLot ? lot : null,
        qty: finalQty,
        location: config.location,
        reason,
        note
      })
      setSuccess({ medName: medication.generic_name, qty: finalQty, desc: config.desc })
      resetSelection(null)
    } catch (err) {
      setError(err.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  if (allowedTabs.length === 0) {
    return (
      <Layout>
        <div className="card empty-state">คุณไม่มีสิทธิ์ทำรายการในหน้านี้</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <h2 className="flex-row"><EditIcon width={22} height={22} /> คืนยา / ปรับยอด / ยาเสีย-หมดอายุ</h2>
      <p className="text-muted text-sm">ทุกรายการในหน้านี้ต้องระบุเหตุผล และถูกบันทึกลง audit log</p>

      {success && (
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <strong className="flex-row"><CheckIcon width={16} height={16} color="var(--success)" /> บันทึกสำเร็จ</strong>
          <p className="mt-0">{success.desc} — {success.medName} • จำนวน {success.qty}</p>
        </div>
      )}

      <div className="tabs">
        {allowedTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'is-active' : ''}
            onClick={() => {
              setTab(t.id)
              resetSelection(null)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form className="card" onSubmit={handleSubmit}>
        {tab === 'return' && canCreateTxType(role, TX_TYPES.RETURN_TO_CENTRAL) && (
          <div className="field">
            <label>ประเภทการคืน</label>
            <div className="tabs">
              <button type="button" className={returnType === TX_TYPES.RETURN_TO_SUBSTOCK ? 'is-active' : ''} onClick={() => { setReturnType(TX_TYPES.RETURN_TO_SUBSTOCK); setLot(null) }}>
                คืนเข้า Substock
              </button>
              <button type="button" className={returnType === TX_TYPES.RETURN_TO_CENTRAL ? 'is-active' : ''} onClick={() => { setReturnType(TX_TYPES.RETURN_TO_CENTRAL); setLot(null) }}>
                คืนไปคลังใหญ่
              </button>
            </div>
          </div>
        )}

        {tab === 'expired_waste' && (
          <>
            <div className="field">
              <label>ประเภท</label>
              <div className="tabs">
                <button type="button" className={ewType === TX_TYPES.EXPIRED ? 'is-active' : ''} onClick={() => setEwType(TX_TYPES.EXPIRED)}>ยาหมดอายุ</button>
                <button type="button" className={ewType === TX_TYPES.WASTE ? 'is-active' : ''} onClick={() => setEwType(TX_TYPES.WASTE)}>ยาเสีย/แตกหัก</button>
              </div>
            </div>
            <div className="field">
              <label>พบที่จุดใด</label>
              <div className="tabs">
                <button type="button" className={ewLocation === LOCATIONS.SUBSTOCK ? 'is-active' : ''} onClick={() => { setEwLocation(LOCATIONS.SUBSTOCK); setLot(null) }}>Substock</button>
                <button type="button" className={ewLocation === LOCATIONS.FLOOR ? 'is-active' : ''} onClick={() => { setEwLocation(LOCATIONS.FLOOR); setLot(null) }}>หน้างานจ่ายยา</button>
              </div>
            </div>
          </>
        )}

        {tab === 'adjust' && (
          <>
            <div className="field">
              <label>จุดที่ปรับยอด</label>
              <div className="tabs">
                <button type="button" className={adjLocation === LOCATIONS.SUBSTOCK ? 'is-active' : ''} onClick={() => { setAdjLocation(LOCATIONS.SUBSTOCK); setLot(null) }}>Substock</button>
                <button type="button" className={adjLocation === LOCATIONS.FLOOR ? 'is-active' : ''} onClick={() => { setAdjLocation(LOCATIONS.FLOOR); setLot(null) }}>หน้างานจ่ายยา</button>
              </div>
            </div>
            <div className="field">
              <label>ลักษณะการปรับ</label>
              <div className="tabs">
                <button type="button" className={adjSign === 1 ? 'is-active' : ''} onClick={() => setAdjSign(1)}>พบเกิน (+)</button>
                <button type="button" className={adjSign === -1 ? 'is-active' : ''} onClick={() => setAdjSign(-1)}>พบขาด (-)</button>
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label>เลือกยา</label>
          <MedicationPicker medications={medications} value={medication} onChange={(m) => { setMedication(m); setLot(null) }} />
        </div>

        {medication && (
          <>
            {config.needsLot && (
              <div className="field">
                <label>เลือกล็อต</label>
                <LotPicker medicationId={medication.id} value={lot} onChange={setLot} mode={config.lotMode} />
              </div>
            )}

            <div className="field">
              <label>จำนวน ({(config.location === LOCATIONS.SUBSTOCK ? medication.unit_issue : medication.unit_dispense) || 'หน่วย'})</label>
              <QtyStepper value={qty} onChange={setQty} min={0} unit={config.location === LOCATIONS.SUBSTOCK ? medication.unit_issue : medication.unit_dispense} />
            </div>

            <div className="field">
              <label htmlFor="reason">เหตุผล (บังคับกรอก)</label>
              <textarea id="reason" className="input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น นับสต็อกประจำเดือนไม่ตรง, ยาแตกระหว่างขนย้าย ฯลฯ" />
            </div>

            <div className="field">
              <label htmlFor="note">หมายเหตุเพิ่มเติม</label>
              <textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {submitting ? 'กำลังบันทึก…' : 'ยืนยันบันทึกรายการ'}
            </button>
          </>
        )}
      </form>
    </Layout>
  )
}
