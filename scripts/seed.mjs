// สคริปต์ seed ข้อมูลยาตัวอย่างสำหรับทดสอบระบบ (ไม่บังคับต้องรัน)
// วิธีใช้:
//   1) ตั้งค่า GOOGLE_APPLICATION_CREDENTIALS ให้ชี้ไปที่ service account key JSON
//      (Firebase Console > Project settings > Service accounts > Generate new private key)
//   2) node scripts/seed.mjs
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

// ตัวอย่างยาที่พบบ่อยในห้องยา OPD รพ.ชุมชน — ปรับ/เพิ่มได้ตามบัญชียาจริงของแต่ละ รพ.
const medications = [
  { generic_name: 'Paracetamol', trade_name: 'Sara', code: 'PARA500', strength: '500 mg', category: 'ยาแก้ปวดลดไข้', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: false, reorder_point_substock: 20, reorder_point_floor: 200, par_level_floor: 500 },
  { generic_name: 'Amoxicillin', trade_name: 'Amoxil', code: 'AMOX500', strength: '500 mg', category: 'ยาปฏิชีวนะ', unit_issue: 'กล่อง', unit_dispense: 'แคปซูล', conversion_factor: 100, is_high_alert: false, reorder_point_substock: 10, reorder_point_floor: 100, par_level_floor: 300 },
  { generic_name: 'Metformin', trade_name: 'Glucophage', code: 'MET500', strength: '500 mg', category: 'ยาเบาหวาน', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: false, reorder_point_substock: 15, reorder_point_floor: 150, par_level_floor: 400 },
  { generic_name: 'Amlodipine', trade_name: 'Norvasc', code: 'AML5', strength: '5 mg', category: 'ยาความดันโลหิต', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: false, reorder_point_substock: 15, reorder_point_floor: 150, par_level_floor: 300 },
  { generic_name: 'Simvastatin', trade_name: 'Zocor', code: 'SIM20', strength: '20 mg', category: 'ยาลดไขมัน', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: false, reorder_point_substock: 10, reorder_point_floor: 100, par_level_floor: 200 },
  { generic_name: 'Insulin NPH', trade_name: 'Humulin N', code: 'INSNPH', strength: '100 IU/mL', category: 'ยาเบาหวาน (ฉีด)', unit_issue: 'กล่อง', unit_dispense: 'ขวด', conversion_factor: 1, is_high_alert: true, reorder_point_substock: 5, reorder_point_floor: 10, par_level_floor: 15 },
  { generic_name: 'Warfarin', trade_name: 'Coumadin', code: 'WAR3', strength: '3 mg', category: 'ยาต้านการแข็งตัวเลือด', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: true, reorder_point_substock: 5, reorder_point_floor: 30, par_level_floor: 60 },
  { generic_name: 'Digoxin', trade_name: 'Lanoxin', code: 'DIG0.25', strength: '0.25 mg', category: 'ยาโรคหัวใจ', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: true, reorder_point_substock: 3, reorder_point_floor: 20, par_level_floor: 40 },
  { generic_name: 'Potassium Chloride', trade_name: 'KCl', code: 'KCL', strength: '600 mg', category: 'อิเล็กโทรไลต์', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: true, reorder_point_substock: 5, reorder_point_floor: 30, par_level_floor: 60 },
  { generic_name: 'Cetirizine', trade_name: 'Zyrtec', code: 'CET10', strength: '10 mg', category: 'ยาแก้แพ้', unit_issue: 'กล่อง', unit_dispense: 'เม็ด', conversion_factor: 100, is_high_alert: false, reorder_point_substock: 10, reorder_point_floor: 100, par_level_floor: 200 },
  { generic_name: 'Omeprazole', trade_name: 'Losec', code: 'OME20', strength: '20 mg', category: 'ยาโรคกระเพาะ', unit_issue: 'กล่อง', unit_dispense: 'แคปซูล', conversion_factor: 100, is_high_alert: false, reorder_point_substock: 10, reorder_point_floor: 100, par_level_floor: 200 },
  { generic_name: 'Salbutamol', trade_name: 'Ventolin', code: 'SAL', strength: '100 mcg/dose', category: 'ยาขยายหลอดลม', unit_issue: 'กล่อง', unit_dispense: 'หลอด', conversion_factor: 10, is_high_alert: false, reorder_point_substock: 5, reorder_point_floor: 15, par_level_floor: 30 }
]

async function seed() {
  const batch = db.batch()
  for (const med of medications) {
    const ref = db.collection('medications').doc()
    batch.set(ref, {
      ...med,
      active: true,
      created_by: 'seed-script',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    })
  }
  await batch.commit()
  console.log(`✅ seed ยาตัวอย่างสำเร็จ ${medications.length} รายการ`)
  console.log('ขั้นตอนถัดไป: สมัครบัญชีแรกผ่านหน้าเว็บ แล้วตั้ง role เป็น "admin" ให้ตัวเองตรงใน Firestore Console (users/{uid}.role = "admin", active = true) เพื่อเข้าใช้งานจัดการระบบครั้งแรก')
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ seed ไม่สำเร็จ:', err)
  process.exit(1)
})
