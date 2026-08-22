import { useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { useCollection } from '../hooks/useCollection'
import { transactionsInRangeQuery, substockInventoryQuery } from '../lib/queries'
import { useStockAlerts } from '../hooks/useStockAlerts'
import { toCSV, downloadCSV } from '../lib/csv'
import {
  buildTransactionRows, TRANSACTION_COLUMNS,
  buildAgingRows, AGING_COLUMNS,
  buildTurnoverRows, TURNOVER_COLUMNS,
  buildDiscrepancyRows, DISCREPANCY_COLUMNS
} from '../lib/reports'
import { TX_TYPE_LABELS } from '../lib/constants'
import { formatThaiDateTime } from '../lib/dates'
import { ReportIcon, DownloadIcon } from '../components/Icons'

function toDateInput(d) {
  return d.toISOString().slice(0, 10)
}
const today = new Date()
const defaultFrom = new Date(today)
defaultFrom.setDate(defaultFrom.getDate() - 30)

export default function Reports() {
  const [dateFrom, setDateFrom] = useState(toDateInput(defaultFrom))
  const [dateTo, setDateTo] = useState(toDateInput(today))
  const [typeFilter, setTypeFilter] = useState('')

  const startDate = useMemo(() => new Date(`${dateFrom}T00:00:00`), [dateFrom])
  const endDate = useMemo(() => new Date(`${dateTo}T23:59:59`), [dateTo])

  const { data: transactions, loading: txLoading } = useCollection(
    transactionsInRangeQuery(startDate, endDate),
    [dateFrom, dateTo]
  )
  const { data: substockInventory } = useCollection(substockInventoryQuery())
  const { medById, floorByMed } = useStockAlerts()

  const filteredTx = typeFilter ? transactions.filter((t) => t.type === typeFilter) : transactions

  function exportTransactions() {
    const rows = buildTransactionRows(filteredTx, medById)
    downloadCSV(`transactions_${dateFrom}_${dateTo}.csv`, toCSV(rows, TRANSACTION_COLUMNS))
  }
  function exportAging() {
    const rows = buildAgingRows(substockInventory, medById)
    downloadCSV(`stock_aging_${toDateInput(today)}.csv`, toCSV(rows, AGING_COLUMNS))
  }
  function exportTurnover() {
    const rows = buildTurnoverRows(transactions, floorByMed, medById)
    downloadCSV(`turnover_${dateFrom}_${dateTo}.csv`, toCSV(rows, TURNOVER_COLUMNS))
  }
  function exportDiscrepancy() {
    const rows = buildDiscrepancyRows(transactions, medById)
    downloadCSV(`discrepancy_log_${dateFrom}_${dateTo}.csv`, toCSV(rows, DISCREPANCY_COLUMNS))
  }

  return (
    <Layout wide>
      <h2 className="flex-row"><ReportIcon width={22} height={22} /> รายงาน / Export</h2>
      <p className="text-muted text-sm">สำหรับใช้ทำรายงาน PTC/CQI และตรวจสอบย้อนหลัง</p>

      <div className="card">
        <div className="section-title mt-0">ตัวกรอง</div>
        <div className="card-grid">
          <div className="field">
            <label htmlFor="dateFrom">จากวันที่</label>
            <input id="dateFrom" type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dateTo">ถึงวันที่</label>
            <input id="dateTo" type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="typeFilter">ประเภทธุรกรรม</label>
          <select id="typeFilter" className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {Object.entries(TX_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="section-title">Export รายงาน</div>
      <div className="card-grid">
        <button type="button" className="btn-tile" onClick={exportTransactions}>
          <DownloadIcon /> ธุรกรรมทั้งหมด (ตามตัวกรอง)
        </button>
        <button type="button" className="btn-tile" onClick={exportAging}>
          <DownloadIcon /> Stock Aging (Substock)
        </button>
        <button type="button" className="btn-tile" onClick={exportTurnover}>
          <DownloadIcon /> Turnover Rate
        </button>
        <button type="button" className="btn-tile" onClick={exportDiscrepancy}>
          <DownloadIcon /> Discrepancy Log
        </button>
      </div>

      <div className="section-title">
        รายการธุรกรรม {txLoading ? '(กำลังโหลด…)' : `(${filteredTx.length} รายการ)`}
      </div>
      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>วันเวลา</th><th>ประเภท</th><th>ยา</th><th>ล็อต</th><th>จำนวน</th><th>จาก→ไป</th><th>ผู้ทำรายการ</th><th>เหตุผล/หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {filteredTx.slice(0, 300).map((t) => (
              <tr key={t.id}>
                <td>{formatThaiDateTime(t.timestamp)}</td>
                <td>{TX_TYPE_LABELS[t.type] || t.type}</td>
                <td>{medById.get(t.medication_id)?.generic_name || t.medication_id}</td>
                <td>{t.lot_no || '-'}</td>
                <td>{t.qty}</td>
                <td>{t.from_location} → {t.to_location || '-'}</td>
                <td>{t.performed_by_name}</td>
                <td>{t.reason || t.note || '-'}</td>
              </tr>
            ))}
            {!txLoading && filteredTx.length === 0 && (
              <tr><td colSpan={8} className="empty-state">ไม่พบรายการในช่วงเวลาที่เลือก</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {filteredTx.length > 300 && (
        <p className="text-muted text-sm">แสดง 300 รายการแรกในตาราง — ใช้ปุ่ม Export ด้านบนเพื่อดูข้อมูลทั้งหมด</p>
      )}
    </Layout>
  )
}
