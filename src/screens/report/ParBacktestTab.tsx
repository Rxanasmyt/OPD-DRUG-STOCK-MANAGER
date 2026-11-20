import { useMemo, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { backtestMed, type BacktestRow } from '../../store/parBacktest';
import { effectiveSubCoverDays } from '../../store/selectors';
import { nf } from '../../utils/format';
import { downloadCsv } from '../../utils/csv';
import { EmptyState } from '../../components/EmptyState';
import { chip, ExecStat } from './shared';

type Filter = 'all' | 'short' | 'excess' | 'better';

const VERDICT = {
  short: { label: 'ขาดบ่อย', color: 'var(--red)', bg: 'var(--red-bg)' },
  excess: { label: 'ค้างเกิน', color: 'var(--amber-ink)', bg: 'var(--amber-bg)' },
  ok: { label: 'พอดี', color: 'var(--green)', bg: 'var(--green-tint)' },
} as const;

/** Replays real dispensing history against each med's CURRENT Min/Max and against what the app would
 * suggest, so a pharmacist can see which settings would have run the shelf dry or sat on too much stock. */
export function ParBacktestTab() {
  const { state, fetchDemandSeries, toast, goSubstockCardFor } = useApp();
  const [testDays, setTestDays] = useState(50);
  const [loading, setLoading] = useState(false);
  const [series, setSeries] = useState<{ dates: string[]; byMed: Map<string, number[]> } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchDemandSeries(180);
      setSeries({ dates: r.dates, byMed: r.byMed as Map<string, number[]> });
    } catch (e) {
      toast((e as Error)?.message || 'ดึงประวัติการใช้ยาไม่สำเร็จ');
    } finally { setLoading(false); }
  };

  const { rows, skipped } = useMemo(() => {
    if (!series) return { rows: [] as BacktestRow[], skipped: 0 };
    const out: BacktestRow[] = [];
    let skip = 0;
    const opts = { testDays, floorCoverDays: state.parFloorCoverDays, subCoverDays: effectiveSubCoverDays(state.parSubCoverDays, state.effectiveLeadTimeDays) };
    for (const m of state.meds) {
      if (!m.active) continue;
      const d = series.byMed.get(m.id);
      const row = d ? backtestMed(m, d, opts) : null;
      if (row && row.demandDays >= 5) out.push(row); else skip++;
    }
    const sev = (r: BacktestRow) => r.current.result.shortageUnits / Math.max(1, r.meanDemand * r.testDays);
    out.sort((a, b) => sev(b) - sev(a) || b.current.result.daysOfCover - a.current.result.daysOfCover);
    return { rows: out, skipped: skip };
  }, [series, testDays, state.meds, state.parFloorCoverDays, state.parSubCoverDays, state.effectiveLeadTimeDays]);

  const better = (r: BacktestRow) => !!r.suggested && r.suggested.result.stockoutDays < r.current.result.stockoutDays;
  const shown = rows.filter((r) => filter === 'all' ? true : filter === 'better' ? better(r) : r.verdict === filter);
  const sum = (f: (r: BacktestRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const curOut = sum((r) => r.current.result.stockoutDays);
  const sugOut = sum((r) => r.suggested ? r.suggested.result.stockoutDays : r.current.result.stockoutDays);
  const inSample = rows.filter((r) => r.basis === 'in-sample').length;

  const exportCsv = async () => {
    const header = ['ชื่อยา', 'ผล(ปัจจุบัน)', 'Max ปัจจุบัน', 'Min ปัจจุบัน', 'ขาด(วัน) ปัจจุบัน', 'ขาด(หน่วย) ปัจจุบัน', 'วันครอบคลุมเฉลี่ย ปัจจุบัน', 'Max แนะนำ', 'Min แนะนำ', 'ขาด(วัน) แนะนำ', 'วันครอบคลุมเฉลี่ย แนะนำ', 'ฐานข้อมูล', 'วันที่ทดสอบ'];
    const body = rows.map((r) => [r.med.name, VERDICT[r.verdict].label, r.current.max, r.current.min, r.current.result.stockoutDays, Math.round(r.current.result.shortageUnits), Math.round(r.current.result.daysOfCover * 10) / 10,
      r.suggested?.max ?? '', r.suggested?.min ?? '', r.suggested?.result.stockoutDays ?? '', r.suggested ? Math.round(r.suggested.result.daysOfCover * 10) / 10 : '', r.basis === 'out-of-sample' ? 'ทดสอบนอกช่วงข้อมูลสอน' : 'ในช่วงเดียวกัน', r.testDays]);
    await downloadCsv([header, ...body], 'ทดสอบ_MinMax_ย้อนหลัง.csv');
  };

  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
        เอาประวัติการจ่ายยาจริงย้อนหลัง (จากไฟล์ HOSxP) มาจำลองว่า ถ้าชั้นหน้างานใช้ Min/Max ที่ตั้งอยู่ — และที่แอพแนะนำ — ของจะ <b>หมดชั้นกี่วัน</b> และ <b>ค้างชั้นกี่วันครอบคลุม</b>
        ทดสอบเฉพาะยาที่มี substock โดยสมมติว่าเติมข้ามคืน (เช้าวันทำการถัดไป) และ substock มีของเสมอ — เป็นการทดสอบ "ชั้น" ไม่ใช่คลังใหญ่
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 11.5 }}>ช่วงทดสอบ</span>
        {[30, 50, 70].map((d) => <button key={d} className="chip" style={chip(testDays === d)} onClick={() => setTestDays(d)}>{d} วันทำการ</button>)}
        <button onClick={load} disabled={loading} className="btn-primary" style={{ marginLeft: 'auto', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, minHeight: 38, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'กำลังโหลด…' : series ? 'โหลดใหม่' : 'รันการทดสอบ'}
        </button>
      </div>

      {!series ? (
        <EmptyState icon="🧪" title="ยังไม่ได้รันการทดสอบ" sub="กด 'รันการทดสอบ' — ใช้ประวัติ 6 เดือนล่าสุด (อ่านข้อมูลครั้งเดียว)" />
      ) : rows.length === 0 ? (
        <EmptyState icon="📭" title="ข้อมูลไม่พอทดสอบ" sub={'ต้องมีประวัติการจ่ายอย่างน้อย 5 วันต่อยา และยามี substock — ข้าม ' + nf(skipped) + ' รายการ'} />
      ) : (
        <>
          <div className="grid-2 stagger" style={{ marginBottom: 10 }}>
            <ExecStat label="ยาที่ทดสอบ" value={nf(rows.length)} note={'ข้าม ' + nf(skipped) + ' (ไม่มี substock/ข้อมูลน้อย)'} />
            <ExecStat label="ขาดชั้น รวม (วัน) — ตั้งอยู่" value={nf(curOut)} tone={curOut > 0 ? 'var(--red)' : undefined} note={nf(rows.filter((r) => r.verdict === 'short').length) + ' รายการขาดบ่อย'} />
            <ExecStat label="ขาดชั้น รวม (วัน) — แอพแนะนำ" value={nf(sugOut)} tone={sugOut > curOut ? 'var(--amber)' : undefined} note={sugOut < curOut ? 'ดีกว่าที่ตั้งอยู่' : sugOut > curOut ? 'ค่าแนะนำขาดมากกว่า — อย่าใช้ทั้งหมดโดยไม่ดู' : 'เท่ากัน'} />
            <ExecStat label="ค้างเกิน (ตั้งอยู่)" value={nf(rows.filter((r) => r.verdict === 'excess').length)} tone={undefined} note="Max สูงกว่าการใช้มาก" />
          </div>
          {inSample > 0 && (
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 9, padding: '8px 10px', marginBottom: 10 }}>
              ⚠ ยา {nf(inSample)} รายการมีประวัติสั้น จึงให้ค่าแนะนำเรียนจากช่วงเดียวกับที่ทดสอบ (ผลของค่าแนะนำจะดูดีกว่าความจริง) — ตัวที่ติดป้าย "ช่วงเดียวกัน" ใช้ดูแนวโน้มเท่านั้น
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
            {([['all', 'ทั้งหมด'], ['short', 'ขาดบ่อย'], ['excess', 'ค้างเกิน'], ['better', 'ค่าแนะนำดีกว่า']] as [Filter, string][]).map(([k, l]) => <button key={k} className="chip" style={chip(filter === k)} onClick={() => setFilter(k)}>{l}</button>)}
            <button onClick={exportCsv} className="btn-outline" style={{ marginLeft: 'auto', padding: '8px 12px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>↓ CSV</button>
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {shown.length === 0 && <div className="muted" style={{ padding: 14, fontSize: 12.5 }}>ไม่มียาในกลุ่มนี้</div>}
            {shown.slice(0, 200).map((r) => {
              const v = VERDICT[r.verdict];
              const cell = (res: BacktestRow['current']['result']) => `ขาด ${res.stockoutDays} วัน${res.shortageUnits > 0 ? ' (−' + nf(Math.round(res.shortageUnits)) + ')' : ''} · ค้างเฉลี่ย ${(Math.round(res.daysOfCover * 10) / 10).toLocaleString('th-TH')} วันใช้`;
              return (
                <div key={r.med.id} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <button onClick={() => goSubstockCardFor(r.med.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, fontSize: 13, fontWeight: 600, color: 'inherit', cursor: 'pointer' }}>{r.med.name}</button>
                    <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: v.color, background: v.bg }}>{v.label}</span>
                    {r.basis === 'in-sample' && <span className="muted" style={{ flex: 'none', fontSize: 10 }}>ช่วงเดียวกัน</span>}
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                    <div><span className="muted">ตั้งอยู่ Max {nf(r.current.max)} / Min {nf(r.current.min)} →</span> {cell(r.current.result)}</div>
                    {r.suggested
                      ? <div><span className="muted">แนะนำ Max {nf(r.suggested.max)} / Min {nf(r.suggested.min)} →</span> {cell(r.suggested.result)}</div>
                      : <div className="muted">ยังไม่มีค่าแนะนำ (ไม่มียอดใช้ในช่วงข้อมูลสอน)</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {shown.length > 200 && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>แสดง 200 รายการแรก — ดาวน์โหลด CSV เพื่อดูทั้งหมด</div>}
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
            วิธีอ่าน: "ขาด N วัน" = วันทำการที่ยอดจ่ายมากกว่าของบนชั้น · "ค้างเฉลี่ย N วันใช้" = ของที่ค้างบนชั้นเฉลี่ยเทียบกับการใช้ต่อวัน (ยิ่งสูงยิ่งค้าง/เสี่ยงหมดอายุ) ·
            ยอดจ่ายคำนวณตามวิธีเดียวกับที่แอพใช้ทำสถิติ (วันหยุดสุดสัปดาห์ไม่นับ) และเป็นยอดที่ตัดจริงจากไฟล์ HOSxP ไม่ใช่ความต้องการที่ไม่ได้ถูกจ่ายเพราะของหมด จึงอาจประเมินการขาดต่ำกว่าจริง
          </div>
        </>
      )}
    </>
  );
}
