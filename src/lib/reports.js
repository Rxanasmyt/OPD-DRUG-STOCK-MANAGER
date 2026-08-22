// ตรรกะประมวลผลรายงานสำหรับหน้า Reports.jsx (แยกจาก UI เพื่อทดสอบ/นำกลับมาใช้ได้ง่าย)
import { formatThaiDate, formatThaiDateTime, daysUntil } from './dates'
import { TX_TYPE_LABELS, TX_TYPES, LOCATION_LABELS } from './constants'

export function buildTransactionRows(transactions, medById) {
  return transactions.map((t) => ({
    วันเวลา: formatThaiDateTime(t.timestamp),
    ประเภท: TX_TYPE_LABELS[t.type] || t.type,
    ยา: medById.get(t.medication_id)?.generic_name || t.medication_id,
    ล็อต: t.lot_no || '-',
    จำนวน: t.qty,
    หน่วย: t.unit || '',
    จาก: LOCATION_LABELS[t.from_location] || t.from_location || '-',
    ไป: LOCATION_LABELS[t.to_location] || t.to_location || '-',
    ผู้ทำรายการ: t.performed_by_name || '',
    เหตุผล: t.reason || '',
    หมายเหตุ: t.note || ''
  }))
}

export const TRANSACTION_COLUMNS = [
  'วันเวลา', 'ประเภท', 'ยา', 'ล็อต', 'จำนวน', 'หน่วย', 'จาก', 'ไป', 'ผู้ทำรายการ', 'เหตุผล', 'หมายเหตุ'
].map((k) => ({ label: k, value: (row) => row[k] }))

/** Stock aging: อายุคงค้างของแต่ละล็อตใน substock ปัจจุบัน (เฉพาะที่ยังมียอด) */
export function buildAgingRows(substockInventory, medById) {
  return substockInventory
    .filter((row) => row.qty > 0)
    .map((row) => {
      const daysToExpiry = daysUntil(row.exp_date)
      const daysSinceReceived = row.received_date ? -daysUntil(row.received_date) : null
      return {
        ยา: medById.get(row.medication_id)?.generic_name || row.medication_id,
        ล็อต: row.lot_no || '-',
        คงเหลือ: row.qty,
        วันรับเข้า: row.received_date ? formatThaiDate(row.received_date) : '-',
        'อายุคงคลัง(วัน)': daysSinceReceived ?? '-',
        วันหมดอายุ: formatThaiDate(row.exp_date),
        'เหลืออีก(วัน)': daysToExpiry ?? '-',
        สถานะ: daysToExpiry === null ? '-' : daysToExpiry < 0 ? 'หมดอายุแล้ว' : daysToExpiry <= 90 ? 'ใกล้หมดอายุ' : 'ปกติ'
      }
    })
    .sort((a, b) => (a['เหลืออีก(วัน)'] ?? 9999) - (b['เหลืออีก(วัน)'] ?? 9999))
}

export const AGING_COLUMNS = [
  'ยา', 'ล็อต', 'คงเหลือ', 'วันรับเข้า', 'อายุคงคลัง(วัน)', 'วันหมดอายุ', 'เหลืออีก(วัน)', 'สถานะ'
].map((k) => ({ label: k, value: (row) => row[k] }))

/**
 * Turnover rate แบบประมาณการ (proxy): ยอดจ่ายออกในช่วงเวลาที่เลือก หารด้วยยอดคงเหลือหน้างานปัจจุบัน
 * หมายเหตุ: เป็นค่าประมาณ ไม่ใช่สูตร inventory turns มาตรฐาน (ซึ่งต้องมี average inventory รายวัน)
 * ใช้เปรียบเทียบ "ยาหมุนไว/หมุนช้า" ระหว่างรายการยาในช่วงเวลาเดียวกันได้
 */
export function buildTurnoverRows(dispenseTransactions, floorByMed, medById) {
  const dispensedByMed = new Map()
  for (const t of dispenseTransactions) {
    if (t.type !== TX_TYPES.DISPENSE) continue
    dispensedByMed.set(t.medication_id, (dispensedByMed.get(t.medication_id) || 0) + (t.qty || 0))
  }
  const rows = []
  for (const [medId, dispensedQty] of dispensedByMed.entries()) {
    const currentQty = floorByMed.get(medId) || 0
    rows.push({
      ยา: medById.get(medId)?.generic_name || medId,
      'จ่ายออกในช่วง': dispensedQty,
      คงเหลือหน้างานปัจจุบัน: currentQty,
      'อัตราหมุนเวียน(ประมาณ)': currentQty > 0 ? Number((dispensedQty / currentQty).toFixed(2)) : dispensedQty > 0 ? '∞' : 0
    })
  }
  return rows.sort((a, b) => (b['จ่ายออกในช่วง'] || 0) - (a['จ่ายออกในช่วง'] || 0))
}

export const TURNOVER_COLUMNS = [
  'ยา', 'จ่ายออกในช่วง', 'คงเหลือหน้างานปัจจุบัน', 'อัตราหมุนเวียน(ประมาณ)'
].map((k) => ({ label: k, value: (row) => row[k] }))

/** Discrepancy log: เฉพาะรายการ "ปรับยอด" (ADJUST) — ใช้ตรวจสอบสาเหตุยอดคลาดเคลื่อนสำหรับ PTC/CQI */
export function buildDiscrepancyRows(transactions, medById) {
  return transactions
    .filter((t) => t.type === TX_TYPES.ADJUST)
    .map((t) => ({
      วันเวลา: formatThaiDateTime(t.timestamp),
      ยา: medById.get(t.medication_id)?.generic_name || t.medication_id,
      จุด: LOCATION_LABELS[t.to_location] || t.to_location,
      'จำนวนที่ปรับ': t.qty,
      เหตุผล: t.reason || '',
      ผู้ทำรายการ: t.performed_by_name || ''
    }))
}

export const DISCREPANCY_COLUMNS = [
  'วันเวลา', 'ยา', 'จุด', 'จำนวนที่ปรับ', 'เหตุผล', 'ผู้ทำรายการ'
].map((k) => ({ label: k, value: (row) => row[k] }))
