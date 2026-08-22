import { useEffect, useRef, useState } from 'react'
import { XIcon, QrIcon } from './Icons'

const REGION_ID = 'qr-reader-region'

/**
 * Modal สแกน QR ด้วย html5-qrcode (โหลดแบบ dynamic import เพื่อไม่ให้ถ่วง bundle หลักตอนไม่ได้ใช้)
 * ใช้สแกนยา/ล็อต และเป็น forcing function ยืนยันยา high-alert ก่อน transfer/dispense
 */
export default function QRScanner({ open, onClose, onDecode, title = 'สแกน QR' }) {
  const scannerRef = useRef(null)
  const [error, setError] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [starting, setStarting] = useState(true)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setError('')
    setStarting(true)

    ;(async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return
        const instance = new Html5Qrcode(REGION_ID, { verbose: false })
        scannerRef.current = instance
        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            onDecode(decodedText)
          },
          () => {} // ignore per-frame decode errors
        )
        if (!cancelled) setStarting(false)
      } catch (err) {
        if (!cancelled) {
          setStarting(false)
          setError('เปิดกล้องไม่ได้ — ตรวจสอบสิทธิ์การเข้าถึงกล้อง หรือกรอกรหัสด้วยตนเองด้านล่าง')
          console.warn('[QRScanner] start failed', err)
        }
      }
    })()

    return () => {
      cancelled = true
      const instance = scannerRef.current
      if (instance) {
        instance
          .stop()
          .then(() => instance.clear())
          .catch(() => {})
      }
      scannerRef.current = null
    }
  }, [open, onDecode])

  if (!open) return null

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-sheet">
        <div className="modal-sheet__header">
          <h3 className="flex-row mt-0"><QrIcon width={20} height={20} /> {title}</h3>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="ปิด">
            <XIcon />
          </button>
        </div>

        <div id={REGION_ID} style={{ width: '100%', minHeight: 240, background: '#000', borderRadius: 10 }} />
        {starting && <p className="text-muted text-sm" style={{ marginTop: 8 }}>กำลังเปิดกล้อง…</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="manual-qr-code">หรือกรอกรหัสด้วยตนเอง</label>
          <div className="flex-row">
            <input
              id="manual-qr-code"
              className="input"
              placeholder="เช่น OPDRX:MED:xxxxx"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!manualCode.trim()}
              onClick={() => onDecode(manualCode.trim())}
            >
              ยืนยัน
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
