// ชั้นเรียกใช้งาน Firestore ทั้งหมดของแอปรวมไว้ที่เดียว — หน้าจอต่าง ๆ เรียกฟังก์ชันจากที่นี่
// แทนที่จะยิง addDoc/updateDoc กระจายอยู่ในแต่ละ component
//
// หลักการสำคัญ: client "ห้าม" เขียน substock_inventory / floor_inventory / alerts ตรง ๆ
// (บล็อกไว้ใน firestore.rules) — ยอดคงเหลือทุกจุดคำนวณโดย Cloud Function onTransactionCreate
// จาก collection `transactions` เพียงแหล่งเดียวเสมอ ป้องกันยอดเพี้ยนจากการเขียนแข่งกัน (race condition)
// ฝั่ง client มีหน้าที่แค่ "บันทึกเจตนา" ลง transactions ให้ครบและถูกต้องเท่านั้น
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase'
import { LOCATIONS, TX_TYPES, TX_TYPES_REQUIRE_REASON } from './constants'

function assertReason(type, reason) {
  if (TX_TYPES_REQUIRE_REASON.has(type) && !reason?.trim()) {
    throw new Error('ต้องระบุเหตุผลสำหรับรายการประเภทนี้')
  }
}

/** บันทึกธุรกรรมลง audit log กลาง — ทุก write ของสต็อกต้องผ่านฟังก์ชันนี้ */
async function addTransaction(profile, base) {
  assertReason(base.type, base.reason)
  if (!base.medication_id) throw new Error('ไม่พบยา')
  const qtyOk =
    base.type === TX_TYPES.ADJUST ? Number.isFinite(base.qty) && base.qty !== 0 : base.qty > 0
  if (!qtyOk) throw new Error('จำนวนไม่ถูกต้อง')

  return addDoc(collection(db, 'transactions'), {
    ...base,
    performed_by: profile.id,
    performed_by_name: profile.name,
    role: profile.role,
    requires_reason: TX_TYPES_REQUIRE_REASON.has(base.type),
    reason: base.reason?.trim() || null,
    note: base.note?.trim() || null,
    lot_id: base.lot_id || null,
    high_alert_confirmed: base.high_alert_confirmed ?? false,
    timestamp: serverTimestamp(),
    // ใช้เรียงลำดับตอนออฟไลน์ (serverTimestamp ยังเป็น null จนกว่าจะ sync)
    created_at_client: Date.now()
  })
}

/** หา lot เดิม (medication+lot_no+exp_date ตรงกัน) เพื่อรวมยอด ไม่สร้างซ้ำ — ถ้าไม่เจอค่อยสร้างใหม่ */
export async function findOrCreateLot({ medicationId, lotNo, expDate, receivedDate, profile }) {
  const lotsRef = collection(db, 'lots')
  const existingQ = query(
    lotsRef,
    where('medication_id', '==', medicationId),
    where('lot_no', '==', lotNo),
    limit(5)
  )
  const snap = await getDocs(existingQ)
  const expMs = new Date(expDate).getTime()
  const match = snap.docs.find((d) => {
    const data = d.data()
    const dExp = data.exp_date?.toDate ? data.exp_date.toDate().getTime() : new Date(data.exp_date).getTime()
    return dExp === expMs
  })
  if (match) return match.id

  const created = await addDoc(lotsRef, {
    medication_id: medicationId,
    lot_no: lotNo,
    exp_date: new Date(expDate),
    received_date: receivedDate ? new Date(receivedDate) : serverTimestamp(),
    created_by: profile.id,
    created_at: serverTimestamp()
  })
  return created.id
}

/** เวิร์กโฟลว์ 1: รับยาเข้า substock จากคลังใหญ่ */
export async function receiveStock(profile, { medication, lotNo, expDate, receivedDate, qty, requisitionNo, note }) {
  const lotId = await findOrCreateLot({
    medicationId: medication.id,
    lotNo,
    expDate,
    receivedDate,
    profile
  })
  return addTransaction(profile, {
    type: TX_TYPES.RECEIVE_FROM_CENTRAL,
    medication_id: medication.id,
    lot_id: lotId,
    qty: Number(qty),
    unit: medication.unit_issue,
    from_location: LOCATIONS.CENTRAL,
    to_location: LOCATIONS.SUBSTOCK,
    requisition_no: requisitionNo?.trim() || null,
    note
  })
}

/** เวิร์กโฟลว์ 2: โอนยาจาก substock ไปหน้างานจ่ายยา (FEFO) */
export async function transferToFloor(profile, { medication, lot, qty, highAlertConfirmed, note }) {
  return addTransaction(profile, {
    type: TX_TYPES.TRANSFER_TO_FLOOR,
    medication_id: medication.id,
    lot_id: lot.lot_id,
    qty: Number(qty),
    unit: medication.unit_issue,
    from_location: LOCATIONS.SUBSTOCK,
    to_location: LOCATIONS.FLOOR,
    high_alert_confirmed: highAlertConfirmed,
    note
  })
}

/** เวิร์กโฟลว์ 3: จ่ายยาให้ผู้ป่วยจากหน้างาน */
export async function dispenseToPatient(profile, { medication, qty, highAlertConfirmed, note, patientRef }) {
  return addTransaction(profile, {
    type: TX_TYPES.DISPENSE,
    medication_id: medication.id,
    qty: Number(qty),
    unit: medication.unit_dispense,
    from_location: LOCATIONS.FLOOR,
    to_location: LOCATIONS.PATIENT,
    high_alert_confirmed: highAlertConfirmed,
    note: [patientRef?.trim() ? `ผู้ป่วย/ใบสั่งยา: ${patientRef.trim()}` : null, note].filter(Boolean).join(' | ') || null
  })
}

/** เวิร์กโฟลว์ 4: คืนยา / ยาเสีย-หมดอายุ / ปรับยอด — บังคับกรอกเหตุผลเสมอ */
export async function adjustOrReturn(profile, { type, medication, lot, qty, location, reason, note }) {
  const isSubstock = location === LOCATIONS.SUBSTOCK
  let from_location = location
  let to_location = null

  if (type === TX_TYPES.RETURN_TO_SUBSTOCK) {
    from_location = LOCATIONS.FLOOR
    to_location = LOCATIONS.SUBSTOCK
  } else if (type === TX_TYPES.RETURN_TO_CENTRAL) {
    from_location = LOCATIONS.SUBSTOCK
    to_location = LOCATIONS.CENTRAL
  } else if (type === TX_TYPES.EXPIRED || type === TX_TYPES.WASTE) {
    to_location = LOCATIONS.DISPOSAL
  } else if (type === TX_TYPES.ADJUST) {
    to_location = location // ปรับยอด ณ จุดเดิม (qty ติดลบได้ = ปรับลด)
  }

  return addTransaction(profile, {
    type,
    medication_id: medication.id,
    lot_id: lot?.lot_id || lot?.id || null,
    qty: type === TX_TYPES.ADJUST ? Number(qty) : Math.abs(Number(qty)),
    unit: isSubstock ? medication.unit_issue : medication.unit_dispense,
    from_location,
    to_location,
    reason,
    note
  })
}

// ===== Admin: จัดการผู้ใช้ =====
/** อนุมัติ/แก้ไข role, แผนก, สถานะการใช้งานของผู้ใช้ (เฉพาะ admin ตาม firestore.rules) */
export async function updateUserProfile(uid, { role, department, active }) {
  const patch = {}
  if (role !== undefined) patch.role = role
  if (department !== undefined) patch.department = department
  if (active !== undefined) patch.active = active
  return updateDoc(doc(db, 'users', uid), patch)
}

// ===== Admin: master data ยา =====
export async function createMedication(profile, data) {
  return addDoc(collection(db, 'medications'), {
    ...data,
    active: true,
    created_by: profile.id,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp()
  })
}

export async function updateMedication(medicationId, data) {
  return updateDoc(doc(db, 'medications', medicationId), { ...data, updated_at: serverTimestamp() })
}

export async function setMedicationActive(medicationId, active) {
  return updateDoc(doc(db, 'medications', medicationId), { active, updated_at: serverTimestamp() })
}
