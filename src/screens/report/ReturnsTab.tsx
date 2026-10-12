import { nf, thDate, fiscalYearStartIso, isoDate } from '../../utils/format';
import type { DrugReturnRecord } from '../../types';
import { categoryLabel } from '../../data/categories';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { chip, ExecStat } from './shared';

export function ReturnsTab({
  rtnFrom, setRtnFrom, rtnTo, setRtnTo, rtnRecords, rtnLoading, rtnLoaded, loadReturns,
  rtnTotalValue, rtnTotalQty, exportDrugReturnsCsv,
}: {
  rtnFrom: string;
  setRtnFrom: (v: string) => void;
  rtnTo: string;
  setRtnTo: (v: string) => void;
  rtnRecords: DrugReturnRecord[];
  rtnLoading: boolean;
  rtnLoaded: boolean;
  loadReturns: () => void;
  rtnTotalValue: number;
  rtnTotalQty: number;
  exportDrugReturnsCsv: (records: DrugReturnRecord[]) => Promise<void>;
}) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
        รวมทุกครั้งที่บันทึก "คืนยา" จากหน้าปรับยอด — วันที่คือวันที่บันทึกรับคืนจริง (ไม่ใช่วันที่ผู้ป่วยมา),
        มูลค่าและหมวดยาคำนวณอัตโนมัติจากตัวยา ณ เวลาที่บันทึก เลือกช่วงวันที่แล้วกด "ดึงรายงาน"
      </div>
      <div className="grid-2" style={{ gap: 8, marginBottom: 10 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
          <input type="date" value={rtnFrom} onChange={(e) => setRtnFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
          <input type="date" value={rtnTo} onChange={(e) => setRtnTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="chip" style={chip(false)} onClick={() => { setRtnFrom(isoDate(Date.now()).slice(0, 8) + '01'); setRtnTo(isoDate(Date.now())); }}>เดือนนี้</button>
        <button className="chip" style={chip(false)} onClick={() => { setRtnFrom(fiscalYearStartIso(Date.now())); setRtnTo(isoDate(Date.now())); }}>ปีงบประมาณนี้</button>
        <button onClick={loadReturns} disabled={rtnLoading || rtnFrom > rtnTo} className="btn-primary" style={{ marginLeft: 'auto', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, minHeight: 38, opacity: rtnLoading || rtnFrom > rtnTo ? 0.6 : 1 }}>
          {rtnLoading ? 'กำลังโหลด…' : 'ดึงรายงาน'}
        </button>
      </div>
      {rtnFrom > rtnTo && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>"จากวันที่" ต้องไม่มากกว่า "ถึงวันที่"</div>}

      {rtnLoading && !rtnLoaded && <SkeletonList rows={6} />}

      {rtnLoaded && !rtnLoading && rtnRecords.length === 0 && (
        <EmptyState icon="↩️" title="ยังไม่มีข้อมูลคืนยาในช่วงนี้" sub="ข้อมูลนี้มาจากการบันทึก “คืนยา” ในหน้าปรับยอดเท่านั้น" />
      )}

      {rtnRecords.length > 0 && (
        <div style={{ opacity: rtnLoading ? 0.45 : 1, pointerEvents: rtnLoading ? 'none' : undefined, transition: 'opacity .15s var(--ease-out)' }}>
          <button
            onClick={() => exportDrugReturnsCsv(rtnRecords)}
            className="btn-outline"
            style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44, marginBottom: 14 }}
          >
            ↓ Export CSV — {nf(rtnRecords.length)} รายการ
          </button>

          <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
            <ExecStat label="มูลค่ายาคืนรวมช่วงนี้" value={nf(rtnTotalValue) + ' บาท'} />
            <ExecStat label="จำนวนรวม (คละหน่วย)" value={nf(rtnTotalQty)} note="รวมหน่วยต่างกันของยาคนละตัว ดูเป็นภาพรวมเท่านั้น" />
            <ExecStat label="จำนวนครั้งที่บันทึกคืนยา" value={nf(rtnRecords.length)} />
            <ExecStat label="จำนวน HN ที่เกี่ยวข้อง" value={nf(new Set(rtnRecords.map((r) => r.hn)).size)} />
          </div>

          <div className="card stagger" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ width: 58, flex: 'none' }}>วันที่</span>
              <span style={{ width: 62, flex: 'none' }}>HN</span>
              <span style={{ flex: 1 }}>ยา / หมวด</span>
              <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>จำนวน</span>
              <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>มูลค่า</span>
            </div>
            {rtnRecords.slice().reverse().map((r, i) => (
              <div key={r.ts + '_' + i} style={{ display: 'flex', padding: '9px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 12.5, alignItems: 'center' }}>
                <span style={{ width: 58, flex: 'none', fontSize: 11 }}>{thDate(r.ts)}</span>
                <span style={{ width: 62, flex: 'none', fontSize: 11.5, fontWeight: 600 }}>{r.hn}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{r.medName}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>
                    {categoryLabel(r.category)}
                    {/* Real-world request: "ยังไม่มีข้อมูลเหตุผลในการคืนยา" — a returns doc
                        written before DrugReturnRecord.reason existed has none at runtime
                        despite the type now requiring it; skip the line entirely rather
                        than show a bare "—" that reads as a data-entry mistake on a real,
                        simply-older record. */}
                    {r.reason && <> · {r.reason}</>}
                  </div>
                </span>
                <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>{nf(r.qty)} {r.unit}</span>
                <span style={{ width: 70, textAlign: 'right', flex: 'none', fontWeight: 600 }}>{nf(Math.round(r.value))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
