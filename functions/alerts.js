// คำนวณแจ้งเตือน reorder point และยาใกล้หมดอายุแบบ server-side แล้วบันทึกลง collection `alerts`
// (ใช้ deterministic id ต่อ 1 สาเหตุ เพื่อ upsert ได้โดยไม่สร้างซ้ำ และ auto-resolve เมื่อเงื่อนไขหายไป)
//
// ทำไมต้องมีคู่กับการคำนวณฝั่ง client (src/hooks/useStockAlerts.js) ที่ real-time กว่า:
// alerts ชุดนี้เป็น "บันทึกที่ server ยืนยันแล้ว" ไว้ต่อยอดส่งแจ้งเตือนภายนอก (อีเมล/LINE Notify)
// ในเฟสถัดไปได้โดยไม่ต้องมีใครเปิดแอปทิ้งไว้ และเก็บเป็นประวัติแจ้งเตือนสำหรับตรวจสอบย้อนหลัง
const { FieldValue } = require('firebase-admin/firestore')

const EXPIRY_WARNING_DAYS = 90

function daysUntil(tsLike) {
  if (!tsLike) return null
  const d = tsLike.toDate ? tsLike.toDate() : new Date(tsLike)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startD - startNow) / 86400000)
}

async function computeAndWriteAlerts(db, logger) {
  const [medsSnap, subSnap, floorSnap, existingAlertsSnap] = await Promise.all([
    db.collection('medications').where('active', '==', true).get(),
    db.collection('substock_inventory').get(),
    db.collection('floor_inventory').get(),
    db.collection('alerts').where('resolved', '==', false).get()
  ])

  const substockByMed = new Map()
  for (const doc of subSnap.docs) {
    const d = doc.data()
    substockByMed.set(d.medication_id, (substockByMed.get(d.medication_id) || 0) + (d.qty || 0))
  }
  const floorByMed = new Map()
  for (const doc of floorSnap.docs) {
    floorByMed.set(doc.id, doc.data().qty || 0)
  }

  const desired = new Map() // alertId -> data (ไม่รวม resolved/updated_at, ใส่ตอน commit)

  for (const doc of medsSnap.docs) {
    const m = doc.data()
    const medId = doc.id
    const substockQty = substockByMed.get(medId) || 0
    const floorQty = floorByMed.get(medId) || 0

    if (m.reorder_point_substock > 0 && substockQty <= m.reorder_point_substock) {
      desired.set(`reorder_substock_${medId}`, {
        type: 'reorder_substock',
        level: substockQty <= 0 ? 'critical' : 'warning',
        medication_id: medId,
        medication_name: m.generic_name || medId,
        message: `Substock "${m.generic_name}" เหลือ ${substockQty} ${m.unit_issue || ''} ต่ำกว่าจุดสั่งซื้อ (${m.reorder_point_substock})`
      })
    }
    if (m.reorder_point_floor > 0 && floorQty <= m.reorder_point_floor) {
      desired.set(`reorder_floor_${medId}`, {
        type: 'reorder_floor',
        level: floorQty <= 0 ? 'critical' : 'warning',
        medication_id: medId,
        medication_name: m.generic_name || medId,
        message: `หน้างานจ่ายยา "${m.generic_name}" เหลือ ${floorQty} ${m.unit_dispense || ''} ต่ำกว่าจุดสั่งซื้อ (${m.reorder_point_floor})`
      })
    }
  }

  for (const doc of subSnap.docs) {
    const d = doc.data()
    if (!(d.qty > 0)) continue
    const days = daysUntil(d.exp_date)
    if (days === null) continue
    if (days < 0) {
      desired.set(`expired_${doc.id}`, {
        type: 'expired_lot',
        level: 'critical',
        medication_id: d.medication_id,
        lot_id: d.lot_id,
        lot_no: d.lot_no || null,
        message: `ล็อต ${d.lot_no || d.lot_id} หมดอายุแล้ว (คงเหลือ ${d.qty}) — ต้องตัดออกจากสต็อกด้วยรายการ "ยาหมดอายุ"`
      })
    } else if (days <= EXPIRY_WARNING_DAYS) {
      desired.set(`expiring_${doc.id}`, {
        type: 'expiring_soon',
        level: days <= 30 ? 'critical' : 'warning',
        medication_id: d.medication_id,
        lot_id: d.lot_id,
        lot_no: d.lot_no || null,
        message: `ล็อต ${d.lot_no || d.lot_id} ใกล้หมดอายุในอีก ${days} วัน (คงเหลือ ${d.qty})`
      })
    }
  }

  const batch = db.batch()
  let writes = 0

  for (const [id, data] of desired.entries()) {
    batch.set(
      db.doc(`alerts/${id}`),
      { ...data, resolved: false, updated_at: FieldValue.serverTimestamp() },
      { merge: true }
    )
    writes++
  }

  for (const doc of existingAlertsSnap.docs) {
    if (!desired.has(doc.id)) {
      batch.update(doc.ref, { resolved: true, resolved_at: FieldValue.serverTimestamp() })
      writes++
    }
  }

  if (writes > 0) await batch.commit()
  logger?.info(`checkReorderAndExpiry: ${desired.size} alert ที่ active, ปรับปรุง ${writes} เอกสาร`)
  return { activeAlerts: desired.size, writes }
}

module.exports = { computeAndWriteAlerts }
