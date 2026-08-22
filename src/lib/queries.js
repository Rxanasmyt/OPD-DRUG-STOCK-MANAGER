// รวม query builder ที่ใช้ซ้ำหลายหน้า (ใช้คู่กับ hooks/useCollection)
import { collection, doc, limit as fsLimit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'

export const medicationsQuery = () => query(collection(db, 'medications'), where('active', '==', true))

export const allMedicationsQuery = () => collection(db, 'medications')

export const substockForMedicationQuery = (medicationId) =>
  query(collection(db, 'substock_inventory'), where('medication_id', '==', medicationId))

export const substockInventoryQuery = () => collection(db, 'substock_inventory')

export const floorInventoryQuery = () => collection(db, 'floor_inventory')

// floor_inventory ใช้ medication_id เป็น document id โดยตรง (ดูเหตุผลใน docs/schema.md)
export const floorInventoryDocRef = (medicationId) => doc(db, 'floor_inventory', medicationId)

export const activeAlertsQuery = () =>
  query(collection(db, 'alerts'), where('resolved', '==', false), orderBy('level', 'desc'))

export const recentTransactionsQuery = (max = 100) =>
  query(collection(db, 'transactions'), orderBy('created_at_client', 'desc'), fsLimit(max))

// รายงาน: ธุรกรรมในช่วงวันที่ (ใช้ฟิลด์ timestamp ที่ server เซ็ตให้ — รายการที่ค้าง sync ตอนออฟไลน์
// จะยังไม่ถูกนับจนกว่าจะ sync สำเร็จ)
export const transactionsInRangeQuery = (startDate, endDate) =>
  query(
    collection(db, 'transactions'),
    where('timestamp', '>=', startDate),
    where('timestamp', '<=', endDate),
    orderBy('timestamp', 'desc'),
    fsLimit(2000)
  )

export const usersQuery = () => query(collection(db, 'users'), orderBy('created_at', 'desc'))
