import { nf, isoDate, DAY } from '../../utils/format';
import type { Tx, MedId } from '../../types';
import { asMedId } from '../../types';
import type { ReplenishMedRow } from '../../store/selectors';
import { categoryLabel } from '../../data/categories';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonList } from '../../components/Skeleton';
import { chip, ExecStat } from './shared';

// Real-world request: "สร้าง dashboard สรุปผลการเติมยา" — a dedicated summary of real
// transfer_to_floor (เติมหน้างาน) activity. The only existing surface for this was
// InsightsTab's narrow "เติมหน้างานบ่อยผิดปกติ" card (a problem list only, fixed 30-day
// window, no qty/value at all) — this is the full picture: how many times, how much, how much
// it's worth, and which drugs dominate that activity, over whatever date range the reader
// actually picks. Same "own date range + fetched rows, local to this screen" shape every other
// report tab here already uses (see ReturnsTab/KpiTab/UsageTab).
const FREQUENT_PER_DAY_THRESHOLD = 0.5;

export function ReplenishTab({
  replFrom, setReplFrom, replTo, setReplTo, replRecords, replLoading, replLoaded, loadReplenish,
  replByMed, replTotalValue, exportFloorRefillsCsv, goSubstockCardFor,
}: {
  replFrom: string;
  setReplFrom: (v: string) => void;
  replTo: string;
  setReplTo: (v: string) => void;
  replRecords: Tx[];
  replLoading: boolean;
  replLoaded: boolean;
  loadReplenish: () => void;
  replByMed: ReplenishMedRow[];
  replTotalValue: number;
  exportFloorRefillsCsv: (records: Tx[]) => Promise<void>;
  goSubstockCardFor: (id: MedId) => void;
}) {
  const replFrequent = replByMed.filter((r) => r.perDay >= FREQUENT_PER_DAY_THRESHOLD).sort((a, b) => b.perDay - a.perDay);
  const replTotalQty = replRecords.reduce((s, r) => s + Math.abs(r.qty), 0);

  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
        รวมทุกครั้งที่ "เติมหน้างาน" (ย้ายจาก substock ไปหน้างาน) ในช่วงที่เลือก — มูลค่าคำนวณจากราคายา
        ปัจจุบัน ไม่ใช่ราคา ณ วันที่เติมจริง เลือกช่วงวันที่แล้วกด "ดึงรายงาน"
      </div>
      <div className="grid-2" style={{ gap: 8, marginBottom: 10 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
          <input type="date" value={replFrom} onChange={(e) => setReplFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
          <input type="date" value={replTo} onChange={(e) => setReplTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 15, minHeight: 40 }} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="chip" style={chip(false)} onClick={() => { setReplFrom(isoDate(Date.now() - 6 * DAY)); setReplTo(isoDate(Date.now())); }}>7 วันล่าสุด</button>
        <button className="chip" style={chip(false)} onClick={() => { setReplFrom(isoDate(Date.now() - 29 * DAY)); setReplTo(isoDate(Date.now())); }}>30 วันล่าสุด</button>
        <button onClick={loadReplenish} disabled={replLoading || replFrom > replTo} className="btn-primary" style={{ marginLeft: 'auto', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, minHeight: 38, opacity: replLoading || replFrom > replTo ? 0.6 : 1 }}>
          {replLoading ? 'กำลังโหลด…' : 'ดึงรายงาน'}
        </button>
      </div>
      {replFrom > replTo && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>"จากวันที่" ต้องไม่มากกว่า "ถึงวันที่"</div>}

      {replLoading && !replLoaded && <SkeletonList rows={6} />}

      {replLoaded && !replLoading && replRecords.length === 0 && (
        <EmptyState icon="🔄" title="ยังไม่มีข้อมูลเติมหน้างานในช่วงนี้" sub="ข้อมูลนี้มาจากการ “เติมหน้างาน” (ย้ายจาก substock) เท่านั้น" />
      )}

      {replRecords.length > 0 && (
        <div style={{ opacity: replLoading ? 0.45 : 1, pointerEvents: replLoading ? 'none' : undefined, transition: 'opacity .15s var(--ease-out)' }}>
          <button
            onClick={() => exportFloorRefillsCsv(replRecords)}
            className="btn-outline"
            style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44, marginBottom: 14 }}
          >
            ↓ Export CSV — {nf(replRecords.length)} รายการ
          </button>

          <div className="grid-2 tablet-4 stagger" style={{ marginBottom: 16 }}>
            <ExecStat label="มูลค่ารวมที่เติมช่วงนี้" value={nf(replTotalValue) + ' บาท'} />
            <ExecStat label="ปริมาณรวม (คละหน่วย)" value={nf(replTotalQty)} note="รวมหน่วยต่างกันของยาคนละตัว ดูเป็นภาพรวมเท่านั้น" />
            <ExecStat label="จำนวนครั้งที่เติมหน้างาน" value={nf(replRecords.length)} />
            <ExecStat
              label="ยาที่เติมบ่อยผิดปกติ"
              value={nf(replFrequent.length) + ' รายการ'}
              note={replFrequent.length > 0 ? 'เติมเฉลี่ย ≥ 1 ครั้ง/2 วัน' : undefined}
              tone={replFrequent.length > 0 ? 'var(--amber)' : 'var(--green)'}
            />
          </div>

          <div className="section-eyebrow" style={{ margin: '0 2px 8px' }}>ยาที่เติมหน้างานมูลค่าสูงสุด</div>
          <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>ยา / หมวด</span>
              <span style={{ width: 54, textAlign: 'right', flex: 'none' }}>ครั้ง</span>
              <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>จำนวน</span>
              <span style={{ width: 70, textAlign: 'right', flex: 'none' }}>มูลค่า</span>
            </div>
            {replByMed.slice(0, 20).map((r) => (
              <button
                key={r.medId}
                onClick={() => goSubstockCardFor(asMedId(r.medId))}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '9px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)', fontSize: 13 }}>{r.medName}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{categoryLabel(r.category)}</div>
                </span>
                <span style={{ width: 54, textAlign: 'right', flex: 'none', fontSize: 12.5 }}>{nf(r.eventCount)}</span>
                <span style={{ width: 70, textAlign: 'right', flex: 'none', fontSize: 12.5 }}>{nf(r.totalQty)} {r.unit}</span>
                <span style={{ width: 70, textAlign: 'right', flex: 'none', fontSize: 12.5, fontWeight: 600 }}>{nf(Math.round(r.totalValue))}</span>
              </button>
            ))}
          </div>

          {/* Same signal InsightsTab's own "เติมหน้างานบ่อยผิดปกติ" card already surfaces (see
              frequentFloorRefills, selectors.ts) — recomputed here over THIS tab's own
              user-chosen date range instead of that card's fixed 30-day window, so a shorter or
              longer lookback stays meaningful (perDay is a rate, not a raw count). */}
          {replFrequent.length > 0 && (
            <>
              <div className="section-eyebrow" style={{ margin: '0 2px 8px' }}>เติมหน้างานบ่อยผิดปกติ</div>
              <div className="card stagger" style={{ overflow: 'hidden' }}>
                {replFrequent.slice(0, 20).map((r) => (
                  <button
                    key={r.medId}
                    onClick={() => goSubstockCardFor(asMedId(r.medId))}
                    className="row-interactive"
                    title="ดูบัตรสต็อกยานี้"
                    style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', justifyContent: 'space-between', gap: 10, padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
                  >
                    <span style={{ fontSize: 13, minWidth: 0, color: 'var(--ink)' }}>{r.medName}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', flex: 'none' }}>เติม {nf(r.eventCount)} ครั้ง</span>
                  </button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, padding: '6px 2px 0' }}>
                เฉลี่ยเติมหน้างานมากกว่า 1 ครั้งทุกๆ 2 วันในช่วงที่เลือก — ลองพิจารณาปรับ par หน้างานของยาเหล่านี้ให้สูงขึ้น เพื่อลดรอบการเติมที่บ่อยเกินจำเป็น
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
