import { useState } from 'react'
import QRScanner from './QRScanner'
import { decodeQR } from '../lib/qr'
import { AlertIcon, CheckIcon, QrIcon } from './Icons'

/**
 * Forcing function สำหรับยา High-alert: ต้องสแกน QR ยืนยันตัวยาซ้ำก่อนกดยืนยัน transfer/dispense
 * (แนวทางเดียวกับ Emergency Box Notify) — ถ้าไม่ใช่ high-alert component นี้จะไม่แสดงผลอะไรเลย
 */
export default function HighAlertConfirm({ medication, confirmed, onConfirmedChange }) {
  const [open, setOpen] = useState(false)
  const [mismatch, setMismatch] = useState(false)

  if (!medication?.is_high_alert) return null

  function handleDecode(text) {
    const { kind, id } = decodeQR(text)
    const isThisMed = (kind === 'medication' || kind === 'ha_confirm') && id === medication.id
    if (isThisMed) {
      onConfirmedChange(true)
      setMismatch(false)
      setOpen(false)
    } else {
      setMismatch(true)
    }
  }

  if (confirmed) {
    return (
      <div className="badge badge-success" style={{ marginBottom: 14 }}>
        <CheckIcon width={14} height={14} /> ยืนยันยา High-alert แล้ว
      </div>
    )
  }

  return (
    <div className="high-alert-banner">
      <AlertIcon width={20} height={20} />
      <div style={{ flex: 1 }}>
        <div>ยานี้เป็นยา High-alert — ต้องสแกน QR ยืนยันตัวยาก่อนทำรายการ</div>
        <button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
          <QrIcon width={16} height={16} /> สแกนยืนยันยา
        </button>
        {mismatch && <p className="error-text">รหัสที่สแกนไม่ตรงกับยาที่เลือก กรุณาลองใหม่</p>}
      </div>

      <QRScanner open={open} onClose={() => setOpen(false)} onDecode={handleDecode} title="สแกนยืนยันยา High-alert" />
    </div>
  )
}
