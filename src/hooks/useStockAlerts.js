import { useMemo } from 'react'
import { useCollection } from './useCollection'
import { allMedicationsQuery, substockInventoryQuery, floorInventoryQuery } from '../lib/queries'
import { daysUntil } from '../lib/dates'
import { EXPIRY_WARNING_DAYS } from '../lib/constants'

/**
 * คำนวณแจ้งเตือน reorder point และยาใกล้หมดอายุแบบ real-time ฝั่ง client
 * (คำนวณจาก snapshot ปัจจุบันเสมอ ไม่ต้องรอรอบ Cloud Function scheduled job)
 *
 * หมายเหตุ: Cloud Function `checkReorderAndExpiry` (functions/index.js) คำนวณชุดเดียวกันนี้ซ้ำ
 * แบบ server-side ทุก 6 ชม. แล้วบันทึกลง collection `alerts` — ไว้ใช้ทำประวัติ/ส่งแจ้งเตือนภายนอก
 * (เช่น LINE Notify/อีเมล ในเฟสถัดไป) โดยไม่ต้องเปิดแอปทิ้งไว้
 */
export function useStockAlerts() {
  const { data: medications, loading: l1 } = useCollection(allMedicationsQuery())
  const { data: substock, loading: l2 } = useCollection(substockInventoryQuery())
  const { data: floor, loading: l3 } = useCollection(floorInventoryQuery())

  return useMemo(() => {
    const substockByMed = new Map()
    for (const row of substock) {
      substockByMed.set(row.medication_id, (substockByMed.get(row.medication_id) || 0) + (row.qty || 0))
    }
    const floorByMed = new Map()
    for (const row of floor) {
      floorByMed.set(row.medication_id || row.id, row.qty || 0)
    }

    const activeMeds = medications.filter((m) => m.active !== false)

    const reorderSubstock = activeMeds.filter(
      (m) => m.reorder_point_substock > 0 && (substockByMed.get(m.id) || 0) <= m.reorder_point_substock
    )
    const reorderFloor = activeMeds.filter(
      (m) => m.reorder_point_floor > 0 && (floorByMed.get(m.id) || 0) <= m.reorder_point_floor
    )

    const expiringSoon = []
    const expiredLots = []
    for (const row of substock) {
      if (!(row.qty > 0)) continue
      const days = daysUntil(row.exp_date)
      if (days === null) continue
      if (days < 0) expiredLots.push({ ...row, daysLeft: days })
      else if (days <= EXPIRY_WARNING_DAYS) expiringSoon.push({ ...row, daysLeft: days })
    }
    expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft)
    expiredLots.sort((a, b) => a.daysLeft - b.daysLeft)

    const medById = new Map(medications.map((m) => [m.id, m]))

    return {
      loading: l1 || l2 || l3,
      medications: activeMeds,
      medById,
      substockByMed,
      floorByMed,
      reorderSubstock,
      reorderFloor,
      expiringSoon,
      expiredLots,
      totalAlerts: reorderSubstock.length + reorderFloor.length + expiringSoon.length + expiredLots.length
    }
  }, [medications, substock, floor, l1, l2, l3])
}
