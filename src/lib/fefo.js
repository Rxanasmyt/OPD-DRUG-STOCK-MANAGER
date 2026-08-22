// FEFO (First-Expired First-Out) helper
// substock_inventory เก็บ lot_no/exp_date แบบ denormalize ไว้ในตัวเอง (อ่านครั้งเดียวไม่ต้อง join lots)
// เพื่อความเร็วของหน้า transfer-to-floor ที่ต้องเลือก lot ได้ทันทีที่เลือกยา

/**
 * เรียง substock lot ของยาตัวหนึ่งตามวันหมดอายุใกล้สุดก่อน (FEFO)
 * @param {Array<{lot_id:string, qty:number, exp_date:any}>} lots
 * @returns lots ที่ qty > 0 เรียงตาม exp_date ascending
 */
export function sortLotsFEFO(lots) {
  return [...lots]
    .filter((l) => (l.qty ?? 0) > 0)
    .sort((a, b) => {
      const da = a.exp_date?.toMillis ? a.exp_date.toMillis() : new Date(a.exp_date).getTime()
      const db_ = b.exp_date?.toMillis ? b.exp_date.toMillis() : new Date(b.exp_date).getTime()
      return da - db_
    })
}

/** lot ที่ควรหยิบก่อนตาม FEFO (ตัวแรกหลังเรียง) */
export function suggestFEFOLot(lots) {
  const sorted = sortLotsFEFO(lots)
  return sorted[0] ?? null
}
