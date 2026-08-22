// ตรรกะปรับยอด inventory จากธุรกรรม — เป็นแหล่งความจริงเดียวของยอดคงเหลือทุกจุด
// รันด้วย Admin SDK (bypass firestore.rules) ภายใน db.runTransaction เพื่อกันเขียนแข่งกัน
//
// ข้อควรทราบ: เพราะแอปฝั่ง client เป็น offline-first สองเครื่องอาจบันทึกธุรกรรมพร้อมกันตอนออฟไลน์
// แล้วมา sync ทีหลังจนยอดติดลบได้ (เช่น โอนยาซ้ำจากอุปกรณ์คนละเครื่องก่อน sync) — ฟังก์ชันนี้ "ไม่ clamp"
// ยอดไว้ที่ 0 โดยเจตนา เพื่อให้เห็นยอดติดลบเป็นสัญญาณให้เภสัชกรเข้าไปตรวจนับและปรับยอด (adjust) จริง
// แทนที่จะซ่อนความคลาดเคลื่อนไว้เงียบ ๆ

const { FieldValue } = require('firebase-admin/firestore')

const substockDocId = (medicationId, lotId) => `${medicationId}_${lotId}`

function earlierExpDate(a, b) {
  if (!a) return b || null
  if (!b) return a
  const aMs = a.toMillis ? a.toMillis() : new Date(a).getTime()
  const bMs = b.toMillis ? b.toMillis() : new Date(b).getTime()
  return aMs <= bMs ? a : b
}

async function bumpSubstock(t, db, medicationId, lotId, delta, extra = {}) {
  const ref = db.doc(`substock_inventory/${substockDocId(medicationId, lotId)}`)
  const snap = await t.get(ref)
  const prevQty = snap.exists ? snap.data().qty || 0 : 0
  t.set(
    ref,
    {
      medication_id: medicationId,
      lot_id: lotId,
      qty: prevQty + delta,
      location: 'substock',
      updated_at: FieldValue.serverTimestamp(),
      ...extra
    },
    { merge: true }
  )
  return snap.exists ? snap.data() : null
}

async function bumpFloor(t, db, medicationId, delta, newEarliestExp) {
  const ref = db.doc(`floor_inventory/${medicationId}`)
  const snap = await t.get(ref)
  const prevQty = snap.exists ? snap.data().qty || 0 : 0
  const patch = {
    medication_id: medicationId,
    qty: prevQty + delta,
    updated_at: FieldValue.serverTimestamp()
  }
  if (newEarliestExp !== undefined) {
    patch.earliest_exp_date = earlierExpDate(snap.exists ? snap.data().earliest_exp_date : null, newEarliestExp)
  }
  t.set(ref, patch, { merge: true })
}

/** ปรับยอด substock_inventory / floor_inventory ตามธุรกรรม 1 รายการ — เรียกจาก onTransactionCreate */
async function applyTransactionToInventory(db, tx) {
  const { type, medication_id: medId, lot_id: lotId, qty, from_location: from, to_location: to } = tx

  await db.runTransaction(async (t) => {
    switch (type) {
      case 'receive_from_central': {
        const lotSnap = await t.get(db.doc(`lots/${lotId}`))
        if (!lotSnap.exists) throw new Error(`ไม่พบล็อต ${lotId}`)
        const lot = lotSnap.data()
        await bumpSubstock(t, db, medId, lotId, qty, {
          lot_no: lot.lot_no ?? null,
          exp_date: lot.exp_date ?? null,
          received_date: lot.received_date ?? null
        })
        break
      }

      case 'transfer_to_floor': {
        const prevSub = await bumpSubstock(t, db, medId, lotId, -qty)
        await bumpFloor(t, db, medId, qty, prevSub?.exp_date)
        break
      }

      case 'dispense': {
        await bumpFloor(t, db, medId, -qty)
        break
      }

      case 'return_to_substock': {
        await bumpFloor(t, db, medId, -qty)
        if (lotId) await bumpSubstock(t, db, medId, lotId, qty)
        break
      }

      case 'return_to_central': {
        await bumpSubstock(t, db, medId, lotId, -qty)
        break
      }

      case 'expired':
      case 'waste': {
        if (from === 'floor') await bumpFloor(t, db, medId, -qty)
        else await bumpSubstock(t, db, medId, lotId, -qty)
        break
      }

      case 'adjust': {
        // qty เป็นค่าที่ signed มาแล้วจากฝั่ง client (+ พบเกิน / - พบขาด)
        if (to === 'floor') await bumpFloor(t, db, medId, qty)
        else await bumpSubstock(t, db, medId, lotId, qty)
        break
      }

      default:
        throw new Error(`ไม่รู้จักประเภทธุรกรรม: ${type}`)
    }
  })
}

module.exports = { applyTransactionToInventory, substockDocId }
