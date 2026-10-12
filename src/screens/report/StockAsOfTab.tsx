import { nf, thDate, isoDate } from '../../utils/format';
import type { MedId } from '../../types';
import { categoryLabel } from '../../data/categories';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { SearchInput } from '../../components/SearchInput';
import { ExecStat } from './shared';

type StockAsOfRow = { medId: MedId; medName: string; unit: string; category: string; floor: number; sub: number; value: number };

export function StockAsOfTab({
  stockAsOfDate, setStockAsOfDate, stockAsOfLoading, stockAsOfLoaded, loadStockAsOf, stockAsOfRows,
  stockAsOfTotalValue, stockAsOfNegativeCount, stockAsOfSearch, setStockAsOfSearch, stockAsOfFiltered,
  goSubstockCardFor, exportStockAsOfCsv,
}: {
  stockAsOfDate: string;
  setStockAsOfDate: (v: string) => void;
  stockAsOfLoading: boolean;
  stockAsOfLoaded: boolean;
  loadStockAsOf: () => void;
  stockAsOfRows: StockAsOfRow[];
  stockAsOfTotalValue: number;
  stockAsOfNegativeCount: number;
  stockAsOfSearch: string;
  setStockAsOfSearch: (v: string) => void;
  stockAsOfFiltered: StockAsOfRow[];
  goSubstockCardFor: (id: MedId) => void;
  exportStockAsOfCsv: (rows: StockAsOfRow[], dateIso: string) => Promise<void>;
}) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
        คำนวณยอดคงคลัง ณ วันที่เลือก โดยเริ่มจากยอดจริงปัจจุบัน แล้วย้อนลบธุรกรรมทุกรายการที่เกิด
        ขึ้น "หลังจาก" วันนั้น — ไม่ได้มาจากข้อมูลที่บันทึกไว้ตรงๆ (Firestore เก็บแค่ยอดปัจจุบัน
        เท่านั้น ไม่มีประวัติยอดคงคลังในตัว) จึงแม่นยำที่สุดสำหรับวันที่ไม่นานมานี้ — ยิ่งย้อนไปไกล
        ยิ่งมีโอกาสสะสมความเพี้ยนถ้าบางช่วงมีการเคลื่อนไหวสต็อกที่ไม่ได้บันทึกเป็นธุรกรรม
      </div>
      <div className="grid-2" style={{ gap: 8, marginBottom: 10 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ดูยอดคงคลัง ณ วันที่</span>
          <input type="date" max={isoDate(Date.now())} value={stockAsOfDate} onChange={(e) => setStockAsOfDate(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 16, minHeight: 40 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={loadStockAsOf} disabled={stockAsOfLoading} className="btn-primary" style={{ width: '100%', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, minHeight: 40, opacity: stockAsOfLoading ? 0.6 : 1 }}>
            {stockAsOfLoading ? 'กำลังคำนวณ…' : 'ดึงยอดคงคลัง'}
          </button>
        </label>
      </div>

      {stockAsOfLoading && !stockAsOfLoaded && <SkeletonList rows={6} />}

      {stockAsOfLoaded && !stockAsOfLoading && stockAsOfRows.length > 0 && (
        <div style={{ opacity: stockAsOfLoading ? 0.45 : 1, pointerEvents: stockAsOfLoading ? 'none' : undefined, transition: 'opacity .15s var(--ease-out)' }}>
          <button
            onClick={() => exportStockAsOfCsv(stockAsOfRows, stockAsOfDate)}
            className="btn-outline"
            style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44, marginBottom: 14 }}
          >
            ↓ Export CSV — {nf(stockAsOfRows.length)} รายการ
          </button>

          <div className="grid-2" style={{ marginBottom: 14 }}>
            <ExecStat label={'มูลค่าคงคลังรวม ณ ' + thDate(new Date(stockAsOfDate + 'T00:00:00').getTime())} value={nf(Math.round(stockAsOfTotalValue)) + ' บาท'} />
            <ExecStat
              label="รายการที่คำนวณได้ติดลบ"
              value={nf(stockAsOfNegativeCount) + ' รายการ'}
              note={stockAsOfNegativeCount > 0 ? 'มีการเคลื่อนไหวที่ไม่ได้บันทึกเป็นธุรกรรมในช่วงนั้น' : 'ไม่พบความผิดปกติ'}
              tone={stockAsOfNegativeCount > 0 ? 'var(--amber)' : 'var(--green)'}
            />
          </div>

          <SearchInput value={stockAsOfSearch} onChange={setStockAsOfSearch} placeholder="ค้นหาชื่อยา" style={{ marginBottom: 9 }} />
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>ยา / หมวด</span>
              <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>หน้างาน</span>
              <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>substock</span>
              <span style={{ width: 80, textAlign: 'right', flex: 'none' }}>มูลค่า</span>
            </div>
            {stockAsOfFiltered.slice(0, 200).map((r) => (
              <button
                key={r.medId}
                onClick={() => goSubstockCardFor(r.medId)}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '9px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, alignItems: 'center' }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{r.medName}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{categoryLabel(r.category)}</div>
                </span>
                <span style={{ width: 70, textAlign: 'right', flex: 'none', color: r.floor < 0 ? 'var(--red)' : 'var(--ink)' }}>{nf(r.floor)}</span>
                <span style={{ width: 70, textAlign: 'right', flex: 'none', color: r.sub < 0 ? 'var(--red)' : 'var(--ink)' }}>{nf(r.sub)}</span>
                <span style={{ width: 80, textAlign: 'right', flex: 'none', fontWeight: 600 }}>{nf(Math.round(r.value))}</span>
              </button>
            ))}
            {stockAsOfFiltered.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่พบยาที่ตรงกับคำค้นหา</div>
            )}
          </div>
          {stockAsOfFiltered.length > 200 && (
            <div className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 8 }}>แสดง 200 จาก {nf(stockAsOfFiltered.length)} รายการ — ค้นหาชื่อยาเพื่อแคบลง</div>
          )}
        </div>
      )}

      {stockAsOfLoaded && !stockAsOfLoading && stockAsOfRows.length === 0 && (
        <EmptyState icon="📜" title="ไม่พบข้อมูลยา" sub="ยังไม่มีรายการยาในระบบ" />
      )}
    </>
  );
}
