import { useMemo, useState } from 'react'
import { SearchIcon, QrIcon, XIcon, AlertIcon } from './Icons'
import QRScanner from './QRScanner'
import { decodeQR } from '../lib/qr'

function normalize(s) {
  return (s || '').toLowerCase().trim()
}

/**
 * ช่องค้นหา/สแกนยา — ใช้แทนการพิมพ์ชื่อยาเต็ม ๆ ทุกครั้งตามข้อกำหนด UX
 * @param {{medications: any[], value: any, onChange: (med:any)=>void}} props
 */
export default function MedicationPicker({ medications, value, onChange, autoFocus = false }) {
  const [term, setTerm] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanMsg, setScanMsg] = useState('')

  const results = useMemo(() => {
    const q = normalize(term)
    if (!q) return []
    return medications
      .filter(
        (m) =>
          normalize(m.generic_name).includes(q) ||
          normalize(m.trade_name).includes(q) ||
          normalize(m.code).includes(q)
      )
      .slice(0, 20)
  }, [term, medications])

  function select(med) {
    onChange(med)
    setTerm('')
  }

  function handleDecode(text) {
    const { kind, id } = decodeQR(text)
    if (kind === 'medication') {
      const med = medications.find((m) => m.id === id)
      if (med) {
        select(med)
        setScanOpen(false)
        setScanMsg('')
        return
      }
      setScanMsg('ไม่พบยาตามรหัสที่สแกน — ยานี้อาจยังไม่ได้ลงทะเบียนในระบบ')
      return
    }
    setScanMsg('QR นี้ไม่ใช่รหัสยา')
  }

  if (value) {
    return (
      <div className="selected-med-card">
        <div>
          <div className="list-row__title">
            {value.generic_name}
            {value.is_high_alert && (
              <span className="badge badge-danger" style={{ marginLeft: 8 }}>
                <AlertIcon width={12} height={12} /> High-alert
              </span>
            )}
          </div>
          <div className="list-row__sub">
            {value.trade_name ? `${value.trade_name} • ` : ''}
            {value.strength} {value.unit_issue ? `• หน่วยเบิก: ${value.unit_issue}` : ''}
          </div>
        </div>
        <button type="button" className="btn btn-icon btn-ghost" onClick={() => onChange(null)} aria-label="เปลี่ยนยา">
          <XIcon />
        </button>
      </div>
    )
  }

  return (
    <div className="search-box">
      <div className="flex-row">
        <div style={{ position: 'relative', flex: 1 }}>
          <SearchIcon
            width={18}
            height={18}
            style={{ position: 'absolute', left: 12, top: 15, color: 'var(--text-muted)' }}
          />
          <input
            className="input"
            style={{ paddingLeft: 38 }}
            placeholder="ค้นหาชื่อยา (generic/การค้า)…"
            value={term}
            autoFocus={autoFocus}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-icon btn-secondary" onClick={() => setScanOpen(true)} aria-label="สแกน QR">
          <QrIcon />
        </button>
      </div>

      {term && (
        <div className="search-results">
          {results.length === 0 && <div className="search-result-item text-muted">ไม่พบยาที่ค้นหา</div>}
          {results.map((m) => (
            <button key={m.id} type="button" className="search-result-item" onClick={() => select(m)}>
              <div className="list-row__title">
                {m.generic_name}
                {m.is_high_alert && <span className="badge badge-danger" style={{ marginLeft: 6 }}>High-alert</span>}
              </div>
              <div className="list-row__sub">{m.trade_name} {m.strength}</div>
            </button>
          ))}
        </div>
      )}

      <QRScanner
        open={scanOpen}
        onClose={() => {
          setScanOpen(false)
          setScanMsg('')
        }}
        onDecode={handleDecode}
        title="สแกน QR ยา"
      />
      {scanOpen && scanMsg && <p className="error-text">{scanMsg}</p>}
    </div>
  )
}
