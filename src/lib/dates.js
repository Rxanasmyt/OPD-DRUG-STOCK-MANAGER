// helper แปลง/แสดงวันที่ — UI ทั้งหมดเป็น พ.ศ. (ปฏิทินไทย) ตามธรรมเนียม รพ.
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
]

export function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value?.toDate === 'function') return value.toDate() // Firestore Timestamp
  return new Date(value)
}

export function formatThaiDate(value) {
  const d = toDate(value)
  if (!d || Number.isNaN(d.getTime())) return '-'
  const day = d.getDate()
  const month = THAI_MONTHS_SHORT[d.getMonth()]
  const yearBE = d.getFullYear() + 543
  return `${day} ${month} ${yearBE}`
}

export function formatThaiDateTime(value) {
  const d = toDate(value)
  if (!d || Number.isNaN(d.getTime())) return '-'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatThaiDate(d)} ${hh}:${mm} น.`
}

// จำนวนวันคงเหลือก่อนหมดอายุ (ปัดเป็นจำนวนเต็ม, ติดลบ = หมดอายุแล้ว)
export function daysUntil(value) {
  const d = toDate(value)
  if (!d) return null
  const now = new Date()
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfD - startOfNow) / 86400000)
}

export function isExpired(value) {
  const days = daysUntil(value)
  return days !== null && days < 0
}
