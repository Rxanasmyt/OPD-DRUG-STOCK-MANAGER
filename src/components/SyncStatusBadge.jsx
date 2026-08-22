import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { usePendingWrites } from '../hooks/usePendingWrites'

/** แสดงสถานะเน็ต + จำนวนธุรกรรมที่ค้าง sync — ต้องเห็นชัดตลอดเวลาตามข้อกำหนด UX */
export default function SyncStatusBadge() {
  const online = useOnlineStatus()
  const pending = usePendingWrites()

  return (
    <span className={`sync-badge ${online ? 'online' : 'offline'}`}>
      <span className="dot" />
      {online ? (pending > 0 ? `กำลังซิงค์ ${pending} รายการ` : 'ออนไลน์') : `ออฟไลน์${pending > 0 ? ` • ค้าง ${pending}` : ''}`}
    </span>
  )
}
