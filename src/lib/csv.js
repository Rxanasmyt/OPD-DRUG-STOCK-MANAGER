// export CSV แบบ client-side ล้วน (ไม่ต้องพึ่ง backend) — เปิดด้วย Excel ได้ (UTF-8 BOM กันภาษาไทยเพี้ยน)
export function toCSV(rows, columns) {
  const escape = (val) => {
    const s = val === null || val === undefined ? '' : String(val)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = columns.map((c) => escape(c.label)).join(',')
  const lines = rows.map((row) => columns.map((c) => escape(c.value(row))).join(','))
  return [header, ...lines].join('\r\n')
}

export function downloadCSV(filename, csvContent) {
  const BOM = '﻿' // Excel เปิดภาษาไทยถูกต้องต้องมี BOM
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
