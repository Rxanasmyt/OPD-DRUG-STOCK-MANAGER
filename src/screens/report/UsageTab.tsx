import { lazy, Suspense } from 'react';
import { nf, fiscalYearStartIso, isoDate, DAY } from '../../utils/format';
import type { UsageHistoryRecord } from '../../types';
import { categoryLabel } from '../../data/categories';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import type { UsageHistoryAgg, CategoryUsageAgg, MonthUsageAgg } from '../../store/selectors';
import { chip, ExecStat } from './shared';

// Lazy — see UsageCharts.tsx's own doc comment for why recharts must never land in this
// screen's main chunk.
const UsageCharts = lazy(() => import('../UsageCharts'));

export function UsageTab({
  usageFrom, setUsageFrom, usageTo, setUsageTo, usageRecords, usageLoading, usageLoaded, loadUsage,
  usageRankBy, setUsageRankBy, usageTopMeds, usageCategoryRows, usageMonthRows, usageTotalQty, usageTotalValue, usageMedCount,
  exportUsageHistoryCsv,
}: {
  usageFrom: string;
  setUsageFrom: (v: string) => void;
  usageTo: string;
  setUsageTo: (v: string) => void;
  usageRecords: UsageHistoryRecord[];
  usageLoading: boolean;
  usageLoaded: boolean;
  loadUsage: () => void;
  usageRankBy: 'value' | 'qty';
  setUsageRankBy: (v: 'value' | 'qty') => void;
  usageTopMeds: UsageHistoryAgg[];
  usageCategoryRows: CategoryUsageAgg[];
  usageMonthRows: MonthUsageAgg[];
  usageTotalQty: number;
  usageTotalValue: number;
  usageMedCount: number;
  exportUsageHistoryCsv: (records: UsageHistoryRecord[]) => Promise<void>;
}) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
        เก็บจำนวน/มูลค่าจริงของแต่ละครั้งที่นำเข้าไฟล์ "ตัดจ่ายยาหน้าชั้นวาง" (หน้าตั้งค่า) แบบถาวร
        ไม่ถูกทับด้วยการนำเข้ารอบใหม่เหมือน used30 — เลือกช่วงวันที่แล้วกด "ดึงรายงาน"
        <br />
        <strong>ข้อจำกัดของข้อมูล:</strong> ไฟล์ HOSxP ที่นำเข้ามีแค่ "ชื่อยา + จำนวนรวม" ต่อช่วงที่ระบุ
        ไม่มีวันที่จ่ายจริงต่อแถว ระบบจึงนับยอดทั้งช่วงไว้ที่ "เดือนเริ่มต้น" ของแต่ละครั้งที่นำเข้าเท่านั้น
        (ไม่ได้เฉลี่ยกระจายตามจริง) และไม่สามารถบอกได้ว่า "วันจันทร์ใช้ยาอะไร" เพราะไฟล์ไม่มีวันที่ต่อรายการ
      </div>
      <div className="grid-2" style={{ gap: 8, marginBottom: 10 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
          <input type="date" value={usageFrom} onChange={(e) => setUsageFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
          <input type="date" value={usageTo} onChange={(e) => setUsageTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="chip" style={chip(false)} onClick={() => { setUsageFrom(fiscalYearStartIso(Date.now())); setUsageTo(isoDate(Date.now())); }}>ปีงบประมาณนี้</button>
        <button className="chip" style={chip(false)} onClick={() => { setUsageFrom(fiscalYearStartIso(Date.now() - 365 * DAY)); setUsageTo(fiscalYearStartIso(Date.now())); }}>ปีงบประมาณก่อน</button>
        <button className="chip" style={chip(false)} onClick={() => { setUsageFrom(isoDate(Date.now()).slice(0, 8) + '01'); setUsageTo(isoDate(Date.now())); }}>เดือนนี้</button>
        <button onClick={loadUsage} disabled={usageLoading || usageFrom > usageTo} className="btn-primary" style={{ marginLeft: 'auto', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, minHeight: 38, opacity: usageLoading || usageFrom > usageTo ? 0.6 : 1 }}>
          {usageLoading ? 'กำลังโหลด…' : 'ดึงรายงาน'}
        </button>
      </div>
      {usageFrom > usageTo && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>"จากวันที่" ต้องไม่มากกว่า "ถึงวันที่"</div>}

      {usageLoading && !usageLoaded && <SkeletonList rows={6} />}

      {usageLoaded && !usageLoading && usageRecords.length === 0 && (
        <EmptyState icon="📈" title="ยังไม่มีข้อมูลในช่วงนี้" sub="ข้อมูลนี้มาจากการนำเข้าไฟล์ตัดจ่ายยาหน้าชั้นวาง (หน้าตั้งค่า) เท่านั้น — ถ้ายังไม่เคยนำเข้าไฟล์ในช่วงนี้ จะไม่มีอะไรให้แสดง" />
      )}

      {usageRecords.length > 0 && (
        <div style={{ opacity: usageLoading ? 0.45 : 1, pointerEvents: usageLoading ? 'none' : undefined, transition: 'opacity .15s var(--ease-out)' }}>
          <button
            onClick={() => exportUsageHistoryCsv(usageRecords)}
            className="btn-outline"
            style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44, marginBottom: 14 }}
          >
            ↓ Export CSV — {nf(usageRecords.length)} รายการ
          </button>

          <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
            <ExecStat label="มูลค่าการใช้ยารวมช่วงนี้" value={nf(Math.round(usageTotalValue)) + ' บาท'} />
            <ExecStat label="ปริมาณรวม (คละหน่วย)" value={nf(usageTotalQty)} note="รวมหน่วยต่างกันของยาคนละตัว ดูเป็นภาพรวมเท่านั้น" />
            <ExecStat label="จำนวนรายการยาที่มีการใช้" value={nf(usageMedCount)} />
            <ExecStat label="จำนวนครั้งที่นำเข้าไฟล์ในช่วงนี้" value={nf(new Set(usageRecords.map((r) => r.periodFrom + '_' + r.periodTo)).size)} />
          </div>

          <Suspense fallback={<SkeletonList rows={3} />}>
            <UsageCharts monthRows={usageMonthRows} categoryRows={usageCategoryRows} />
          </Suspense>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 8px' }}>
            <div className="section-eyebrow">Top 100 ยาที่ใช้มากที่สุด</div>
            <div style={{ display: 'flex', gap: 5 }}>
              <button className="chip" style={{ ...chip(usageRankBy === 'value'), padding: '5px 10px', fontSize: 11, minHeight: 28 }} onClick={() => setUsageRankBy('value')}>เรียงตามมูลค่า</button>
              <button className="chip" style={{ ...chip(usageRankBy === 'qty'), padding: '5px 10px', fontSize: 11, minHeight: 28 }} onClick={() => setUsageRankBy('qty')}>เรียงตามปริมาณ</button>
            </div>
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ width: 28, flex: 'none' }}>#</span>
              <span style={{ flex: 1 }}>ยา / หมวด</span>
              <span style={{ width: 90, textAlign: 'right', flex: 'none' }}>ปริมาณ</span>
              <span style={{ width: 80, textAlign: 'right', flex: 'none' }}>มูลค่า</span>
            </div>
            {usageTopMeds.map((r, i) => (
              <div key={r.medId} style={{ display: 'flex', padding: '9px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, alignItems: 'center' }}>
                <span style={{ width: 28, flex: 'none', color: 'var(--muted)', fontWeight: 700 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{r.medName}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{categoryLabel(r.category)}</div>
                </span>
                <span style={{ width: 90, textAlign: 'right', flex: 'none' }}>{nf(r.qty)} {r.unit}</span>
                <span style={{ width: 80, textAlign: 'right', flex: 'none', fontWeight: 600 }}>{nf(Math.round(r.value))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
