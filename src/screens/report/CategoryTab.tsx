import { nf } from '../../utils/format';
import type { CategoryStat } from '../../store/selectors';
import { EmptyState } from '../../components/EmptyState';

export function CategoryTab({
  catRows, catMaxValue, catTotalValue, expiryWarnDays,
}: {
  catRows: CategoryStat[];
  catMaxValue: number;
  catTotalValue: number;
  expiryWarnDays: number;
}) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
        มูลค่าคงคลัง = (ยอดหน้างาน + substock) × ราคาต่อหน่วย · "ต่ำกว่า Min" คือจำนวนรายการที่ต้องเติมด่วนในหมวดนั้น ·
        "เสี่ยงหมดอายุ" คิดจาก lot ที่เหลือ ≤ {expiryWarnDays} วัน (ตั้งค่าได้ในหน้าตั้งค่า)
      </div>
      <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {catRows.map((r) => (
          <div key={r.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>{r.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, flex: 'none' }}>{nf(r.value)} บาท</span>
            </div>
            <div className="bar-track" style={{ height: 5, background: 'var(--border-soft)', borderRadius: 3, marginTop: 7 }}>
              <div className="bar-fill" style={{ height: '100%', transform: 'scaleX(' + Math.max(2, Math.round((r.value / catMaxValue) * 100)) / 100 + ')', background: 'var(--green)', borderRadius: 3 }} />
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <span>{nf(r.meds)} รายการ</span>
              <span style={r.low > 0 ? { color: 'var(--red)', fontWeight: 700 } : undefined}>ต่ำกว่า Min {nf(r.low)}</span>
              <span style={r.atRisk > 0 ? { color: 'var(--amber-ink)', fontWeight: 700 } : undefined}>เสี่ยงหมดอายุ {nf(r.atRisk)} บาท</span>
              <span>จ่าย 30 วัน {nf(r.used30)}</span>
            </div>
          </div>
        ))}
        {catRows.length === 0 && <EmptyState icon="🏷" title="ยังไม่มีข้อมูลหมวดยา" sub="เพิ่มยาเข้าระบบ หรือกด 'จัดหมวดหมู่ยาทั้งหมดอัตโนมัติ' ในหน้าจัดการรายการยาก่อน" />}
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, padding: '0 2px' }}>
        มูลค่าคงคลังรวมทุกหมวด <b style={{ color: 'var(--ink)' }}>{nf(catTotalValue)} บาท</b> — ใช้ประกอบรายงาน PTC/บัญชียา เรื่องสัดส่วนมูลค่าคงคลังแยกตามกลุ่มยา
      </div>
    </>
  );
}
