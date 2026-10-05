// Hospital-specific weekly OPD clinic schedule (จันทร์–ศุกร์ only — the real weekly schedule; no
// entry for 0/6 since there's no special weekday clinic to call out then). Keyed by
// Date.prototype.getDay() (0=อาทิตย์..6=เสาร์) — see utils/format.ts's bangkokWeekday() for the
// timezone-safe way to compute that key from a real timestamp.
//
// Originally local to TransferScreen.tsx's own "คลินิกวันนี้" informational banner; hoisted here
// so analyzeWeekdayUsage()'s insight panel (AppContext.tsx/SettingsScreen.tsx) can cross-
// reference a drug's detected busiest weekday against the REAL clinic schedule that plausibly
// explains it (real-world request: "การใช้ยาแต่ละวันในคลินิกที่แตกต่างกัน ยาที่ใช้ในแต่ละวันก็จะ
// ต่างกัน"), without a second, could-drift-out-of-sync copy of the same schedule.
export const WEEKDAY_NAME: Record<number, string> = {
  0: 'อาทิตย์', 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์',
};

export const WEEKDAY_CLINICS: Record<number, string> = {
  1: 'จันทร์: COPD / หอบหืด, TB, ANC',
  2: 'อังคาร: เบาหวาน',
  3: 'พุธ: ไตเรื้อรัง (CKD), ANC',
  4: 'พฤหัสบดี: ความดันโลหิตสูง',
  5: 'ศุกร์: Warfarin, หัวใจ/หลอดเลือด, จิตเวช',
};
