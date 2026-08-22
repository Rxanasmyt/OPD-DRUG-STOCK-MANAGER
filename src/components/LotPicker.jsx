import { useEffect, useMemo } from 'react'
import { useCollection } from '../hooks/useCollection'
import { substockForMedicationQuery } from '../lib/queries'
import { sortLotsFEFO } from '../lib/fefo'
import { formatThaiDate, daysUntil } from '../lib/dates'
import { CheckIcon } from './Icons'

/**
 * เลือกล็อตยาจาก substock
 * mode="fefo" (ค่าเริ่มต้น): ใช้ตอน "โอนไปหน้างาน" — โชว์เฉพาะล็อตที่ยังมียอด, auto-select ล็อตใกล้หมดอายุสุด (FEFO)
 * mode="all": ใช้ตอน "คืนยา/ปรับยอด/ยาหมดอายุ" — โชว์ทุกล็อตที่เคยรับเข้า substock (รวมยอด 0) ให้ผู้ใช้เลือกเอง ไม่ auto-select
 */
export default function LotPicker({ medicationId, value, onChange, mode = 'fefo' }) {
  const { data, loading } = useCollection(
    medicationId ? substockForMedicationQuery(medicationId) : null,
    [medicationId]
  )

  const sorted = useMemo(() => {
    if (mode === 'all') {
      return [...data].sort((a, b) => {
        const da = a.exp_date?.toMillis ? a.exp_date.toMillis() : new Date(a.exp_date).getTime()
        const db_ = b.exp_date?.toMillis ? b.exp_date.toMillis() : new Date(b.exp_date).getTime()
        return da - db_
      })
    }
    return sortLotsFEFO(data)
  }, [data, mode])

  useEffect(() => {
    if (mode === 'fefo' && !value && sorted.length > 0) onChange(sorted[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, mode])

  if (!medicationId) return null
  if (loading) return <p className="text-muted text-sm">กำลังโหลดล็อตยา…</p>

  if (sorted.length === 0) {
    return <div className="pending-banner">ไม่มียานี้ใน Stock ย่อยห้องยา (substock) — กรุณารับยาเข้าก่อน</div>
  }

  return (
    <div>
      {sorted.map((lot, idx) => {
        const days = daysUntil(lot.exp_date)
        const isSelected = value?.lot_id === lot.lot_id
        const expBadge =
          days !== null && days < 0
            ? 'badge-danger'
            : days !== null && days <= 90
              ? 'badge-warning'
              : 'badge-neutral'
        return (
          <button
            key={lot.id}
            type="button"
            className={`lot-option ${isSelected ? 'is-selected' : ''} ${mode === 'fefo' && idx === 0 ? 'is-fefo' : ''}`}
            onClick={() => onChange(lot)}
          >
            <span>
              <span className="list-row__title">ล็อต {lot.lot_no || '-'}</span>
              <span className="list-row__sub">
                <span className={`badge ${expBadge}`} style={{ marginRight: 6 }}>
                  หมดอายุ {formatThaiDate(lot.exp_date)}
                </span>
                คงเหลือ {lot.qty?.toLocaleString('th-TH') ?? 0} หน่วย
              </span>
            </span>
            {isSelected && <CheckIcon width={18} height={18} color="var(--primary-dark)" />}
          </button>
        )
      })}
    </div>
  )
}
