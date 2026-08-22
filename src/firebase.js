// ตั้งค่า Firebase SDK กลางของแอป
//
// การออกแบบ "offline mode": เราไม่เขียน offline queue เองซ้ำซ้อน แต่ใช้ Firestore
// persistent local cache (IndexedDB) ของ SDK โดยตรง — เมื่อออฟไลน์ การ read จะอ่านจาก
// cache ล่าสุด และการ write (addDoc/setDoc/updateDoc) จะถูกเก็บไว้ใน cache แล้ว sync
// อัตโนมัติทันทีที่เน็ตกลับมา ไม่ต้องรอ user กดซิงค์เอง
// ดู src/hooks/useOnlineStatus.js และ src/hooks/usePendingWrites.js สำหรับ UI แสดงสถานะ
import { initializeApp, getApps } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

if (!firebaseConfig.projectId) {
  // ช่วยให้ debug ง่ายตอน deploy ครั้งแรกถ้าลืมตั้งค่า .env
  console.warn(
    '[firebase] ไม่พบค่า VITE_FIREBASE_* ใน environment — คัดลอก .env.example เป็น .env แล้วใส่ค่าจาก Firebase Console'
  )
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)

// persistentSingleTabManager: ใช้แท็บเดียวต่อเครื่อง (เหมาะกับแท็บเล็ต/มือถือหน้างานที่เปิดแอปแท็บเดียว)
// ถ้าจะรองรับหลายแท็บพร้อมกันบนเครื่องเดียว เปลี่ยนเป็น persistentMultipleTabManager()
// บาง browser/โหมด private ไม่รองรับ IndexedDB persistence — fallback เป็น in-memory cache
// (แอปยังใช้งานได้ปกติ แต่จะไม่ค้าง transaction ระหว่างออฟไลน์ข้ามการปิดแท็บ)
let dbInstance
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager({ forceOwnership: false })
    })
  })
} catch (err) {
  console.warn('[firebase] เปิด persistent offline cache ไม่ได้ ใช้ in-memory cache แทน:', err)
  dbInstance = initializeFirestore(app, {})
}
export const db = dbInstance

export const auth = getAuth(app)
export const functions = getFunctions(app, 'asia-southeast1')

export default app
