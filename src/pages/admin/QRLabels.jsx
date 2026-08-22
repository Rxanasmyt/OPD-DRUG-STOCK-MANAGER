import { useEffect, useState } from 'react'
import Layout from '../../components/Layout'
import { useCollection } from '../../hooks/useCollection'
import { allMedicationsQuery } from '../../lib/queries'
import { encodeMedicationQR } from '../../lib/qr'
import { QrIcon, PrinterIcon, AlertIcon } from '../../components/Icons'

/**
 * พิมพ์ QR label ของยา (ติดหน้ากล่อง/ช่องเก็บ) — สแกนใช้ในหน้า รับยา/โอน/จ่ายยา
 * และเป็นขั้นตอนยืนยันบังคับ (forcing function) สำหรับยา High-alert
 */
export default function QRLabels() {
  const { data: medications, loading } = useCollection(allMedicationsQuery())
  const [selected, setSelected] = useState(() => new Set())
  const [highAlertOnly, setHighAlertOnly] = useState(false)
  const [images, setImages] = useState({})

  const visible = highAlertOnly ? medications.filter((m) => m.is_high_alert) : medications

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const QRCode = await import('qrcode')
      const entries = await Promise.all(
        visible.map(async (m) => [m.id, await QRCode.toDataURL(encodeMedicationQR(m.id), { margin: 1, width: 160 })])
      )
      if (!cancelled) setImages(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [visible.map((m) => m.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const printList = selected.size > 0 ? visible.filter((m) => selected.has(m.id)) : visible

  return (
    <Layout wide>
      <div className="no-print">
        <h2 className="flex-row"><QrIcon width={22} height={22} /> พิมพ์ QR Label ยา</h2>
        <p className="text-muted text-sm">
          QR แต่ละดวงเข้ารหัสรหัสยาของระบบ ใช้สแกนในหน้ารับยา/โอนย้าย/จ่ายยา และเป็นการยืนยันตัวยา High-alert ก่อนทำรายการ
        </p>

        <div className="card">
          <label className="flex-row" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={highAlertOnly} onChange={(e) => setHighAlertOnly(e.target.checked)} style={{ width: 20, height: 20 }} />
            แสดงเฉพาะยา High-alert <AlertIcon width={14} height={14} />
          </label>
          <p className="text-muted text-sm">เลือกยาที่ต้องการพิมพ์ (ไม่เลือกเลย = พิมพ์ทั้งหมดที่แสดง)</p>
          {loading && <p className="text-muted text-sm">กำลังโหลด…</p>}
          <div className="stack">
            {visible.map((m) => (
              <label key={m.id} className="list-row" style={{ cursor: 'pointer' }}>
                <span className="flex-row">
                  <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} style={{ width: 18, height: 18 }} />
                  {m.generic_name} {m.is_high_alert && <span className="badge badge-danger">High-alert</span>}
                </span>
              </label>
            ))}
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <PrinterIcon width={18} height={18} /> พิมพ์ ({printList.length} รายการ)
        </button>
      </div>

      <div className="qr-print-grid">
        {printList.map((m) => (
          <div className="qr-label" key={m.id}>
            {images[m.id] && <img src={images[m.id]} alt={m.generic_name} width={120} height={120} />}
            <div className="qr-label__name">{m.generic_name}</div>
            {m.trade_name && <div className="qr-label__sub">{m.trade_name}</div>}
            {m.is_high_alert && <div className="qr-label__ha">⚠ HIGH-ALERT</div>}
          </div>
        ))}
      </div>
    </Layout>
  )
}
