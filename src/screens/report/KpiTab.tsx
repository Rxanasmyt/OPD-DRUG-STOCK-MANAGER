import { nf, isoDate, DAY } from '../../utils/format';
import type { DailyMetrics } from '../../types';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { printKpiReportSheet } from '../../utils/print';
import { chip, ExecStat } from './shared';

export function KpiTab({
  kpiFrom, setKpiFrom, kpiTo, setKpiTo, kpiRows, kpiLoading, kpiLoaded, loadKpi,
  kpiLast, kpiSum, kpiDamagedLossSum, kpiExpiredLossSum, kpiReconcileMissedDays, kpiStockoutRatePct, kpiLeadTimeWeightedHours,
  exportDailyMetricsCsv, userName, toast,
}: {
  kpiFrom: string;
  setKpiFrom: (v: string) => void;
  kpiTo: string;
  setKpiTo: (v: string) => void;
  kpiRows: DailyMetrics[];
  kpiLoading: boolean;
  kpiLoaded: boolean;
  loadKpi: () => void;
  kpiLast: DailyMetrics | undefined;
  kpiSum: (f: (r: DailyMetrics) => number) => number;
  kpiDamagedLossSum: number;
  kpiExpiredLossSum: number;
  kpiReconcileMissedDays: number;
  kpiStockoutRatePct: number | null;
  kpiLeadTimeWeightedHours: number | null;
  exportDailyMetricsCsv: (rows: DailyMetrics[]) => Promise<void>;
  userName: () => string;
  toast: (t: string) => void;
}) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
        เก็บ snapshot อัตโนมัติทุกวันโดยระบบ (มูลค่า/ปริมาณคงคลัง, อัตราการจ่าย/เบิก, ความแม่นยำข้อมูล,
        กิจกรรมผู้ใช้งาน) — เลือกช่วงวันที่แล้วกด "ดึงรายงาน" เพื่อดูแนวโน้มย้อนหลังได้ทุกช่วง
        ข้อมูลเริ่มมีตั้งแต่วันที่ระบบเริ่มเก็บอัตโนมัติเป็นต้นไป วันที่ยังไม่มี snapshot จะไม่ปรากฏในผลลัพธ์
      </div>
      <div className="grid-2" style={{ gap: 8, marginBottom: 10 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
          <input type="date" value={kpiFrom} onChange={(e) => setKpiFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
          <input type="date" value={kpiTo} onChange={(e) => setKpiTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="chip" style={chip(false)} onClick={() => { setKpiFrom(isoDate(Date.now() - 6 * DAY)); setKpiTo(isoDate(Date.now())); }}>7 วันล่าสุด</button>
        <button className="chip" style={chip(false)} onClick={() => { setKpiFrom(isoDate(Date.now() - 29 * DAY)); setKpiTo(isoDate(Date.now())); }}>30 วันล่าสุด</button>
        <button className="chip" style={chip(false)} onClick={() => { setKpiFrom(isoDate(Date.now() - 89 * DAY)); setKpiTo(isoDate(Date.now())); }}>90 วันล่าสุด</button>
        <button onClick={loadKpi} disabled={kpiLoading || kpiFrom > kpiTo} className="btn-primary" style={{ marginLeft: 'auto', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, minHeight: 38, opacity: kpiLoading || kpiFrom > kpiTo ? 0.6 : 1 }}>
          {kpiLoading ? 'กำลังโหลด…' : 'ดึงรายงาน'}
        </button>
      </div>
      {kpiFrom > kpiTo && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>"จากวันที่" ต้องไม่มากกว่า "ถึงวันที่"</div>}

      {/* First-ever fetch (no stale rows to fall back on yet) — a shape that already
          looks like the report loading beats a blank gap under the button's own
          "กำลังโหลด…" label. */}
      {kpiLoading && !kpiLoaded && <SkeletonList rows={6} />}

      {kpiLoaded && !kpiLoading && kpiRows.length === 0 && (
        <EmptyState icon="📅" title="ยังไม่มีข้อมูลในช่วงนี้" sub="ระบบเก็บ snapshot วันละ 1 ครั้งอัตโนมัติ — ถ้าเพิ่งเริ่มใช้ระบบนี้ ให้รอสักวันหรือลองเลือกช่วงวันที่ใหม่กว่านี้" />
      )}

      {kpiRows.length > 0 && (
        // Bug fix: picking a new date range and re-fetching used to leave the PREVIOUS
        // range's numbers sitting there looking perfectly fresh while a new request was
        // actually in flight — dim + disable interaction so a stale table never reads as
        // current.
        <div style={{ opacity: kpiLoading ? 0.45 : 1, pointerEvents: kpiLoading ? 'none' : undefined, transition: 'opacity .15s var(--ease-out)' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button
              onClick={() => exportDailyMetricsCsv(kpiRows)}
              className="btn-outline"
              style={{ flex: 1, padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44 }}
            >
              ↓ Export CSV — {nf(kpiRows.length)} วัน
            </button>
            <button
              onClick={() => {
                const ok = printKpiReportSheet(kpiRows, { fromDate: kpiFrom, toDate: kpiTo, printedBy: userName() });
                if (!ok) toast('เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
              }}
              className="btn-primary"
              style={{ flex: 1, padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 700, minHeight: 44 }}
            >
              🖨 พิมพ์รายงานทางการ
            </button>
          </div>

          <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
            <ExecStat label="มูลค่าคงคลังล่าสุด" value={kpiLast ? nf(Math.round(kpiLast.totalStockValue)) + ' บาท' : '—'} note={kpiLast ? 'ณ ' + kpiLast.date : undefined} />
            {/* Bug fix (KPI clarity): these two sum a raw qty across the ENTIRE active
                formulary — tablets + ml + vials + boxes for hundreds of different drugs
                all added into one number, unlike the neighboring tiles (บาท/%/รายการ/ชม.)
                which all use one real, consistent unit. Printed on the official PTC
                summary sheet, an unlabeled "48,213" here reads as a real volume figure —
                it isn't one. Labeling explicitly as "คละหน่วย" (mixed units) so a
                reviewer skimming the printed report doesn't mistake it for something it's
                not. */}
            <ExecStat label="รับเข้ารวมช่วงนี้ (คละหน่วย)" value={nf(kpiSum((r) => r.receivedQty))} note={nf(kpiSum((r) => r.receivedCount)) + ' ครั้ง'} />
            <ExecStat label="จ่ายจริงรวม (HOSxP, คละหน่วย)" value={nf(kpiSum((r) => r.dispensedQty))} note={kpiReconcileMissedDays > 0 ? kpiReconcileMissedDays + ' วันไม่ได้ตัดยอด' : 'ตัดยอดครบทุกวัน'} tone={kpiReconcileMissedDays > 0 ? 'var(--amber)' : undefined} />
            <ExecStat
              label="par ผิดพลาดล่าสุด"
              value={kpiLast ? nf(kpiLast.parErrorCount) + ' รายการ' : '—'}
              note={kpiLast ? 'ควรทบทวนอีก ' + nf(kpiLast.parReviewCount) : undefined}
              tone={kpiLast && kpiLast.parErrorCount > 0 ? 'var(--red)' : 'var(--green)'}
            />
            <ExecStat
              label="อัตราขาดสต็อกจริงล่าสุด"
              value={kpiStockoutRatePct != null ? kpiStockoutRatePct.toFixed(1) + '%' : '—'}
              note={kpiLast ? nf(kpiLast.stockoutCount) + '/' + nf(kpiLast.usedMedCount) + ' รายการที่มีการใช้จริง' : undefined}
              tone={kpiStockoutRatePct != null && kpiStockoutRatePct > 0 ? 'var(--red)' : 'var(--green)'}
            />
            <ExecStat
              label="เวลารอเบิกยาเฉลี่ย"
              value={kpiLeadTimeWeightedHours != null ? kpiLeadTimeWeightedHours.toFixed(1) + ' ชม.' : '—'}
              note={kpiLeadTimeWeightedHours != null ? nf(kpiSum((r) => r.receiveApprovedCount)) + ' รายการที่อนุมัติในช่วงนี้' : 'ไม่มีรายการเบิกที่อนุมัติในช่วงนี้'}
            />
            {/* Real-world request: "เก็บมูลค่าความเสียหาย/หมดอายุที่ตัดจริง" — unlike
                "มูลค่าคงคลังล่าสุด" above (a current-snapshot figure, only ever meaningful
                as of one date), this sums a real historical FLOW across the whole selected
                date range — "เสียไปจริงกี่บาทช่วงนี้" — so it's safe to add across many days
                the same way รับเข้า/จ่ายจริง above already are. */}
            <ExecStat
              label="มูลค่าเสีย/หมดอายุที่ตัดจริงช่วงนี้"
              value={nf(Math.round(kpiDamagedLossSum + kpiExpiredLossSum)) + ' บาท'}
              note={'ของเสีย ' + nf(Math.round(kpiDamagedLossSum)) + ' · หมดอายุ ' + nf(Math.round(kpiExpiredLossSum))}
              tone={kpiDamagedLossSum + kpiExpiredLossSum > 0 ? 'var(--amber)' : undefined}
            />
          </div>

          <div className="section-eyebrow" style={{ margin: '0 2px 8px' }}>แนวโน้มรายวัน</div>
          <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ width: 76, flex: 'none' }}>วันที่</span>
              <span style={{ flex: 1, textAlign: 'right' }}>มูลค่าคงคลัง</span>
              <span style={{ width: 64, textAlign: 'right', flex: 'none' }}>จ่ายจริง</span>
              <span style={{ width: 60, textAlign: 'right', flex: 'none' }}>par ผิด</span>
              <span style={{ width: 56, textAlign: 'right', flex: 'none' }}>ผู้ใช้</span>
            </div>
            {kpiRows.slice().reverse().map((r) => (
              <div key={r.date} style={{ display: 'flex', padding: '9px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, alignItems: 'center' }}>
                <span style={{ width: 76, flex: 'none', color: 'var(--ink)' }}>{r.date.slice(5)}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{nf(Math.round(r.totalStockValue))}</span>
                <span style={{ width: 64, textAlign: 'right', flex: 'none' }}>{nf(r.dispensedQty)}</span>
                <span style={{ width: 60, textAlign: 'right', flex: 'none', fontWeight: r.parErrorCount > 0 ? 700 : 400, color: r.parErrorCount > 0 ? 'var(--red)' : 'var(--muted)' }}>{nf(r.parErrorCount)}</span>
                <span style={{ width: 56, textAlign: 'right', flex: 'none' }}>{nf(r.activeUserCount)}</span>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, padding: '0 2px' }}>
            "มูลค่าคงคลัง" ของแต่ละวันบันทึกจากยอดจริง ณ ตอนที่ระบบเก็บ snapshot (หลังเที่ยงคืนของวันนั้น) —
            ส่วน "จ่ายจริง/par ผิด/ผู้ใช้" อ้างอิงประวัติธุรกรรมจริงของวันนั้นเสมอ ถูกต้องไม่ว่าจะดูย้อนหลังไปนานแค่ไหน
          </div>
        </div>
      )}
    </>
  );
}
