// Cloud Functions ของระบบจัดการสต็อกยา OPD (2nd gen, region asia-southeast1)
//
// 1) onTransactionCreate — trigger ทุกครั้งที่มีการสร้างธุรกรรมใหม่ใน `transactions`
//    ปรับยอด substock_inventory/floor_inventory ให้ตรงเสมอ (ดู inventory.js)
// 2) checkReorderAndExpiry — รันทุก 6 ชั่วโมง สแกน reorder point และวันหมดอายุ บันทึกลง `alerts` (ดู alerts.js)
// 3) runAlertCheckNow — callable function ให้ admin กดรันแจ้งเตือนได้ทันทีโดยไม่ต้องรอรอบถัดไป (เช่นตอน demo/deploy ใหม่)
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { setGlobalOptions } = require('firebase-functions/v2')
const logger = require('firebase-functions/logger')

const { applyTransactionToInventory } = require('./inventory')
const { computeAndWriteAlerts } = require('./alerts')

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 })
initializeApp()
const db = getFirestore()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

exports.onTransactionCreate = onDocumentCreated('transactions/{txId}', async (event) => {
  const snap = event.data
  if (!snap) return
  const tx = snap.data()

  // ลองซ้ำสั้น ๆ ก่อนยอมแพ้: เคสที่พบบ่อยสุดคือ client ยิง "รับยาเข้า" (สร้าง lot + transaction
  // เป็น 2 การเขียนแยกกัน) ตอนออฟไลน์ แล้ว sync เกือบพร้อมกันจน trigger นี้ทำงานก่อนที่ lot doc จะ
  // เขียนเสร็จ — รอสั้น ๆ แล้วลองใหม่มักจะผ่าน ไม่ต้องพึ่ง retry ระดับ Cloud Functions (ซึ่งจะวนซ้ำ
  // ทั้งอีเวนต์ยาวเกินจำเป็นถ้า error ไม่ใช่ transient)
  const MAX_ATTEMPTS = 4
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await applyTransactionToInventory(db, tx)
      await snap.ref.update({ processed: true, processed_at: new Date() })
      return
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 500)
    }
  }

  logger.error('onTransactionCreate: ปรับยอด inventory ไม่สำเร็จหลังลองซ้ำแล้ว', {
    txId: event.params.txId,
    type: tx.type,
    medication_id: tx.medication_id,
    error: lastErr.message
  })
  // ไม่ throw ซ้ำ (จะทำให้ retry วนลูปไม่จบ) — flag ไว้ให้ admin ตรวจสอบและแก้ด้วยรายการ "ปรับยอด" แทน
  await snap.ref.update({ processed: false, processing_error: lastErr.message }).catch(() => {})
})

exports.checkReorderAndExpiry = onSchedule(
  { schedule: 'every 6 hours', timeZone: 'Asia/Bangkok' },
  async () => {
    await computeAndWriteAlerts(db, logger)
  }
)

exports.runAlertCheckNow = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อน')
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get()
  const caller = callerSnap.data()
  if (!caller?.active || !['admin', 'pharmacist'].includes(caller.role)) {
    throw new HttpsError('permission-denied', 'ต้องเป็นเภสัชกรหรือ admin เท่านั้น')
  }
  return computeAndWriteAlerts(db, logger)
})
