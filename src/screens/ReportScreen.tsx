import { useApp } from '../store/AppContext';
import { useEffect, useState } from 'react';
import { subQty, daysUntil, usageAnomalies, daysOfStockLeft, categoryStats, dailyUsageRate, toneFor } from '../store/selectors';
import { nf, thDate, isoDate, DAY } from '../utils/format';
import type { ReportTab, DailyMetrics } from '../types';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';

// "exec" leads the tab strip — a PTC/pharmacy-head reader opening this screen wants the
// headline picture first, not to have to find it after four operational tabs. "kpi" trails
// everything else — it's a distinct kind of report (historical trend over a chosen range, not
// "right now"), so it gets its own visual treatment (see isKpi below) the same way "insights"
// already does for "computed, not just filtered".
const TABS: [ReportTab, string][] = [['exec', '📊 ภาพรวมผู้บริหาร'], ['aging', 'Stock aging'], ['category', 'แยกตามหมวดยา'], ['turn', 'Turnover'], ['insights', '🧠 วิเคราะห์อัตโนมัติ'], ['disc', 'Discrepancy log'], ['kpi', '📅 ตัวชี้วัดย้อนหลัง']];
const REPORT_NAMES: Record<ReportTab, string> = { exec: 'executive_summary.csv', aging: 'stock_aging.csv', category: 'stock_by_category.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv', insights: 'usage_insights.csv', kpi: 'kpi_metrics.csv' };
const AGING_BUCKETS: [string, number, number, string][] = [
  ['หมดอายุแล้ว', -99999, 0, 'var(--red)'],
  ['เหลือ ≤ 30 วัน', 0, 30, 'var(--red)'],
  ['31–90 วัน', 30, 90, 'var(--amber)'],
  ['91–180 วัน', 90, 180, 'var(--muted)'],
  ['มากกว่า 180 วัน', 180, 99999, 'var(--green)'],
];
const DISC_TYPES = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];
const DISC_TYPE_LABEL: Record<string, string> = {
  adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'หมดอายุ', count: 'นับสต็อก', reconcile_hosxp: 'นำเข้า HOSxP',
};

export default function ReportScreen() {
  const {
    state, setReportTab, exportReportCsv, exportAllReports, printExecutiveSummary, goSubstockCardFor, fetchExecTxsThisMonth,
    fetchDailyMetrics, exportDailyMetricsCsv,
  } = useApp();
  // Discrepancy log had no way to narrow it down — always the same fixed most-recent-30 slice
  // of state.txs, with no type filter and no way to find one specific drug's history, unlike
  // AdminScreen's audit log right next door which has both. Same underlying data (the live
  // txs feed), same treatment now: a type filter and a name search, both client-side since
  // state.txs is already the same capped-300 realtime cache AdminScreen reads from.
  const [discFilter, setDiscFilter] = useState<string>('all');
  const [discSearch, setDiscSearch] = useState('');
  // OPD/IPD ward tabs removed — reports always cover the whole formulary.
  const meds = state.meds.filter((m) => m.active);
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  const medIds = new Set(meds.map((m) => m.id));
  const wardLots = state.lots.filter((l) => medIds.has(l.medId));
  const buckets = AGING_BUCKETS.map(([label, lo, hi, fg]) => {
    const ls = wardLots.filter((l) => l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
    const value = ls.reduce((s, l) => s + l.qty * (meds.find((m) => m.id === l.medId)?.price || 0), 0);
    return { label, fg, lots: ls.length, value };
  });
  const maxVal = Math.max(1, ...buckets.map((b) => b.value));
  const riskValue = buckets[0].value + buckets[1].value + buckets[2].value;

  // ---------- ภาพรวมผู้บริหาร (exec tab) ----------
  // Same underlying numbers aging/turn/category already compute above — this just rolls them
  // into one headline-first view a pharmacy head/PTC reader can scan without visiting every tab.
  const execHealthy = meds.filter((m) => toneFor(m) === 'var(--green)').length;
  const execWarn = meds.filter((m) => toneFor(m) === 'var(--amber)').length;
  const execCritical = meds.length - execHealthy - execWarn;
  const execHealthyPct = meds.length ? Math.round((execHealthy / meds.length) * 100) : 100;
  const execTotalValue = meds.reduce((s, m) => s + (m.floor + subQty(state, m.id)) * m.price, 0);
  // state.txs is the realtime cache capped to the 300 most-recent rows across ALL types, so it
  // under-counts once a busy month exceeds that cap — use it only as an instant placeholder
  // while the true server-side count (uncapped) loads in.
  const [execTxsFresh, setExecTxsFresh] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetchExecTxsThisMonth().then((n) => { if (live && n != null) setExecTxsFresh(n); });
    return () => { live = false; };
  }, [fetchExecTxsThisMonth]);
  const execTxsThisMonth = execTxsFresh ?? state.txs.filter((x) => x.ts >= Date.now() - 30 * 86400000).length;
  const execByValue = meds
    .map((m) => ({ m, oh: m.floor + subQty(state, m.id), value: (m.floor + subQty(state, m.id)) * m.price }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const execByUsage = meds
    .filter((m) => m.used30 > 0)
    .slice()
    .sort((a, b) => b.used30 - a.used30)
    .slice(0, 10);

  const turnRate = (m: (typeof meds)[number]) => m.used30 / Math.max(1, m.parFloor);
  const turnRows = meds
    .slice()
    .sort((a, b) => turnRate(b) - turnRate(a))
    .slice(0, 30)
    .map((m) => {
      const onHand = m.floor + subQty(state, m.id);
      const doh = Math.round(onHand / dailyUsageRate(m));
      // A drug with no recorded usage (used30 === 0) divides to Infinity/NaN here — already
      // shown as "—" rather than a broken number, but the tone below used to fall through to
      // the same green as a genuinely healthy days-on-hand, falsely reading as "plenty of
      // stock" for a metric that's actually undefined for this drug.
      const tone = !isFinite(doh) ? 'var(--muted)' : doh < 14 ? 'var(--red)' : doh > 120 ? 'var(--amber)' : 'var(--green)';
      return { id: m.id, name: m.name, used: nf(m.used30), doh: isFinite(doh) ? nf(doh) : '—', tone };
    });

  // Per-therapeutic-group rollup — the report the drug categories added in v3.2.0 were
  // ultimately for: which groups tie up the most money, which are running low across the
  // board, and which have expiry risk concentrated in them. Same pure selector the CSV export
  // uses, so the exported spreadsheet can never disagree with what's on screen.
  const catRows = categoryStats(state, meds, state.expiryWarnDays);
  const catMaxValue = Math.max(1, ...catRows.map((r) => r.value));
  const catTotalValue = catRows.reduce((s2, r) => s2 + r.value, 0);

  const discQ = discSearch.trim().toLowerCase();
  const discRows = state.txs
    .filter((x) => DISC_TYPES.indexOf(x.type) >= 0)
    .filter((x) => discFilter === 'all' || x.type === discFilter)
    .filter((x) => !discQ || x.name.toLowerCase().indexOf(discQ) >= 0)
    .slice(0, 60);

  // "🧠 วิเคราะห์อัตโนมัติ" — real numbers computed on-device from usage data already synced
  // (used30/usedPrev30 from recomputeUsageStats/commitUsageImport), not a call to any AI
  // service — this app is a static site with no backend to hold an API key safely, so an
  // actual LLM call from here would mean shipping that key in public client code. Two useful
  // things fall straight out of data already on hand: which drugs' usage swung sharply enough
  // to need attention, and which are projected to run out soonest at their current pace.
  const anomalies = usageAnomalies(meds);
  const stockoutRows = meds
    .map((m) => ({ m, days: daysOfStockLeft(state, m) }))
    .filter((x): x is { m: (typeof meds)[number]; days: number } => x.days !== null && x.days <= 21)
    .sort((a, b) => a.days - b.days)
    .slice(0, 20);

  // ---------- 📅 ตัวชี้วัดย้อนหลัง (kpi tab) ----------
  // Own date range + fetched rows, local to this screen — a bounded historical query, not part
  // of the always-live global state everything else on this screen reads from. Defaults to the
  // last 30 days so the tab shows something useful the moment it's opened, same as every other
  // report tab here does with whatever's already in state.
  const [kpiFrom, setKpiFrom] = useState(() => isoDate(Date.now() - 29 * DAY));
  const [kpiTo, setKpiTo] = useState(() => isoDate(Date.now()));
  const [kpiRows, setKpiRows] = useState<DailyMetrics[]>([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiLoaded, setKpiLoaded] = useState(false);
  const loadKpi = () => {
    setKpiLoading(true);
    fetchDailyMetrics(kpiFrom, kpiTo).then((rows) => { setKpiRows(rows); setKpiLoaded(true); }).finally(() => setKpiLoading(false));
  };
  useEffect(() => {
    if (state.reportTab === 'kpi' && !kpiLoaded) loadKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reportTab]);
  const kpiSum = (f: (r: DailyMetrics) => number) => kpiRows.reduce((s, r) => s + f(r), 0);
  const kpiLast = kpiRows[kpiRows.length - 1];
  const kpiReconcileMissedDays = kpiRows.filter((r) => !r.reconciledToday).length;

  return (
    <div style={{ animation: 'fade .18s' }}>
      <div style={{ padding: '12px 14px 10px', position: 'sticky', top: 0, zIndex: 2 }} className="sticky-bar">
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', marginBottom: 9 }}>
          {TABS.map(([t, label]) => {
            const isAi = t === 'insights';
            const active = state.reportTab === t;
            // The insights tab gets its own violet/cyan treatment (see .ai-* in styles.css)
            // instead of the plain green chip every other tab uses — it's the one tab
            // computing something (anomaly detection, a forecast) rather than just
            // filtering/displaying stored numbers, and the visual says so at a glance.
            return (
              <button
                key={t}
                className={'chip' + (isAi && active ? ' ai-glow' : '')}
                style={isAi
                  ? active
                    ? { minHeight: 38, border: 0, background: 'linear-gradient(90deg, var(--ai-1), var(--ai-2))', color: '#fff', fontWeight: 700 }
                    : { minHeight: 38, border: '1px solid var(--ai-1)', background: 'var(--bg-card)', color: 'var(--ai-1)' }
                  : { ...chip(active), minHeight: 38 }}
                onClick={() => setReportTab(t)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ padding: '12px 14px 24px' }}>
        <button
          onClick={exportAllReports}
          disabled={!!state.busy['exportAll']}
          className="btn-primary"
          style={{ width: '100%', padding: 13, borderRadius: 11, fontSize: 14, fontWeight: 700, minHeight: 48, marginBottom: 8, opacity: state.busy['exportAll'] ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {state.busy['exportAll'] ? 'กำลังรวบรวมข้อมูล…' : '📦 ดาวน์โหลดข้อมูลทั้งหมด (.xlsx ไฟล์เดียว)'}
        </button>
        <div className="muted" style={{ fontSize: 11, textAlign: 'center', marginBottom: 10, lineHeight: 1.5 }}>
          รวมทุกอย่างในแอพเป็นไฟล์เดียว คนละ sheet: รายงานสำเร็จรูปทั้ง 4 ชุด · ธุรกรรมทุกประเภททั้งหมด
          (ไม่ใช่แค่ discrepancy) · audit log เต็ม · ใบรับที่รออนุมัติ · รายชื่อผู้ใช้ (เฉพาะ Admin) ·
          ยาทั้งฟอร์มูลารี่ครบทุกฟิลด์ · lot ทุก lot ที่เคยรับเข้า (รวมที่หมด/ตัดออกแล้ว) · ค่าตั้งค่าระบบ
        </div>
        {/* "kpi" has its own date-range-scoped export below (exportDailyMetricsCsv on the
            fetched rows) — the generic exportReportCsv here only ever knows how to export
            whatever's in state right now, which doesn't make sense for a historical range. */}
        {state.reportTab !== 'kpi' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={exportReportCsv} className="btn-outline" style={{ flex: 1, padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44 }}>
              ↓ Export CSV — {REPORT_NAMES[state.reportTab]}
            </button>
            {state.reportTab === 'exec' && (
              <button onClick={printExecutiveSummary} className="btn-primary" style={{ flex: 1, padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 700, minHeight: 44 }}>
                🖨 พิมพ์สรุปสำหรับ PTC
              </button>
            )}
          </div>
        )}

        {state.reportTab === 'exec' && (
          <>
            <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
              <ExecStat label="มูลค่าคงคลังรวม" value={nf(Math.round(execTotalValue)) + ' บาท'} />
              <ExecStat label="สุขภาพคลังยาโดยรวม" value={execHealthyPct + '% ปกติ'} note={`วิกฤต ${nf(execCritical)} · เริ่มต่ำ ${nf(execWarn)}`} tone={execHealthyPct >= 80 ? 'var(--green)' : execHealthyPct >= 50 ? 'var(--amber)' : 'var(--red)'} />
              <ExecStat label={`มูลค่าเสี่ยงหมดอายุ ≤ ${state.expiryWarnDays} วัน`} value={nf(Math.round(riskValue)) + ' บาท'} tone={riskValue > 0 ? 'var(--amber)' : 'var(--green)'} />
              <ExecStat label="ธุรกรรมใน 30 วันล่าสุด" value={nf(execTxsThisMonth) + ' รายการ'} note={nf(meds.length) + ' รายการยา active'} />
            </div>

            <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em', margin: '0 2px 8px', textTransform: 'uppercase' }}>10 อันดับมูลค่าคงคลังสูงสุด</div>
            <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 18 }}>
              {execByValue.map((r) => (
                <button key={r.m.id} onClick={() => goSubstockCardFor(r.m.id)} className="row-interactive" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.m.name}</span>
                  <span style={{ flex: 'none', fontWeight: 700 }}>{nf(Math.round(r.value))} บาท</span>
                </button>
              ))}
              {execByValue.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีข้อมูล</div>}
            </div>

            <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em', margin: '0 2px 8px', textTransform: 'uppercase' }}>10 อันดับใช้เร็วที่สุด (จ่าย 30 วัน)</div>
            <div className="card stagger" style={{ overflow: 'hidden' }}>
              {execByUsage.map((m) => (
                <button key={m.id} onClick={() => goSubstockCardFor(m.id)} className="row-interactive" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  <span style={{ flex: 'none', fontWeight: 700 }}>{nf(m.used30)} {m.unit}</span>
                </button>
              ))}
              {execByUsage.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีข้อมูลการใช้ยา</div>}
            </div>
          </>
        )}

        {state.reportTab === 'aging' && (
          <>
            <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 14 }}>
              {buckets.map((b) => (
                <div key={b.label} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: b.fg }}>{b.label}</span>
                    <span className="muted" style={{ fontSize: 13, flex: 'none' }}>{b.lots} lot · {nf(b.value)} บาท</span>
                  </div>
                  <div className="bar-track" style={{ height: 6, background: 'var(--border-soft)', borderRadius: 3, marginTop: 7 }}>
                    <div className="bar-fill" style={{ height: '100%', width: Math.max(2, Math.round((b.value / maxVal) * 100)) + '%', background: b.fg, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, padding: '0 2px' }}>
              มูลค่าที่เสี่ยงหมดอายุใน 90 วัน <b style={{ color: 'var(--amber-ink)' }}>{nf(riskValue)} บาท</b> — ใช้ประกอบรายงาน PTC เรื่องการบริหารยาใกล้หมดอายุ
            </div>
          </>
        )}

        {state.reportTab === 'category' && (
          <>
            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 11 }}>
              มูลค่าคงคลัง = (ยอดหน้างาน + substock) × ราคาต่อหน่วย · "ต่ำกว่า Min" คือจำนวนรายการที่ต้องเติมด่วนในหมวดนั้น ·
              "เสี่ยงหมดอายุ" คิดจาก lot ที่เหลือ ≤ {state.expiryWarnDays} วัน (ตั้งค่าได้ในหน้าตั้งค่า)
            </div>
            <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 12 }}>
              {catRows.map((r) => (
                <div key={r.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, flex: 'none' }}>{nf(r.value)} บาท</span>
                  </div>
                  <div className="bar-track" style={{ height: 5, background: 'var(--border-soft)', borderRadius: 3, marginTop: 7 }}>
                    <div className="bar-fill" style={{ height: '100%', width: Math.max(2, Math.round((r.value / catMaxValue) * 100)) + '%', background: 'var(--green)', borderRadius: 3 }} />
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
        )}

        {state.reportTab === 'turn' && (
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>รายการยา</span><span style={{ width: 64, textAlign: 'right', flex: 'none' }}>จ่าย 30 วัน</span><span style={{ width: 52, textAlign: 'right', flex: 'none' }}>วันคงคลัง</span>
            </div>
            {turnRows.map((t, i) => (
              <button
                key={i}
                onClick={() => goSubstockCardFor(t.id)}
                className="row-interactive"
                title="ดูบัตรสต็อกยานี้"
                style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)' }}>{t.name}</span>
                <span style={{ width: 64, textAlign: 'right', flex: 'none', fontSize: 13, color: 'var(--ink)' }}>{t.used}</span>
                <span style={{ width: 52, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: t.tone }}>{t.doh}</span>
              </button>
            ))}
          </div>
        )}

        {state.reportTab === 'insights' && (
          <>
            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, padding: '0 2px', marginBottom: 13 }}>
              คำนวณจากสถิติการใช้ยาที่มีอยู่แล้วในระบบโดยตรง (ไม่ได้เรียกใช้ AI ภายนอกใดๆ — แอพนี้
              เป็น static site ไม่มีเซิร์ฟเวอร์ที่จะเก็บกุญแจ API ได้อย่างปลอดภัย) อัปเดตอัตราการใช้
              ให้ล่าสุดก่อนที่หน้า "ตั้งค่า" เพื่อให้ผลตรงกับความจริงที่สุด
            </div>

            <div style={{ fontSize: 13, margin: '0 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="ai-text" style={{ fontWeight: 800 }}>📊 การใช้ยาผิดปกติ</span>
              {anomalies.length > 0 && <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>({anomalies.length} รายการ)</span>}
            </div>
            <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 16 }}>
              {anomalies.slice(0, 20).map((a, i) => (
                <button
                  key={i}
                  onClick={() => goSubstockCardFor(a.med.id)}
                  className="row-interactive"
                  title="ดูบัตรสต็อกยานี้"
                  style={{ display: 'block', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, color: 'var(--ink)' }}>{a.med.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: a.direction === 'up' ? 'var(--red)' : 'var(--amber-ink)', flex: 'none' }}>
                      {a.direction === 'up' ? '📈 +' : '📉 '}{Math.round(a.changePct * 100)}%
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                    30 วันล่าสุด {nf(a.med.used30)} {a.med.unit} · ก่อนหน้า {nf(a.med.usedPrev30)} {a.med.unit}
                    {a.direction === 'up' ? ' — ลองพิจารณาปรับ par ขึ้นก่อนของจะไม่พอ' : ' — par ปัจจุบันอาจสูงเกินความจำเป็นแล้ว'}
                  </div>
                </button>
              ))}
              {anomalies.length === 0 && (
                <EmptyState icon="📊" title="ไม่พบการใช้ยาที่ผิดปกติ" sub="อัตราการใช้ 30 วันล่าสุดของทุกรายการยังใกล้เคียงกับช่วงก่อนหน้า" />
              )}
            </div>

            <div style={{ fontSize: 13, margin: '0 2px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="ai-text" style={{ fontWeight: 800 }}>⏳ คาดว่าจะหมดใน 21 วัน</span>
              {stockoutRows.length > 0 && <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>({stockoutRows.length} รายการ)</span>}
            </div>
            <div className="card stagger" style={{ overflow: 'hidden' }}>
              {stockoutRows.map(({ m, days }, i) => (
                <button
                  key={i}
                  onClick={() => goSubstockCardFor(m.id)}
                  className="row-interactive"
                  title="ดูบัตรสต็อกยานี้"
                  style={{ display: 'flex', width: '100%', border: 0, background: 'transparent', textAlign: 'left', justifyContent: 'space-between', gap: 10, padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}
                >
                  <span style={{ fontSize: 13, minWidth: 0, color: 'var(--ink)' }}>{m.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: days <= 7 ? 'var(--red)' : 'var(--amber-ink)', flex: 'none' }}>~{days} วัน</span>
                </button>
              ))}
              {stockoutRows.length === 0 && (
                <EmptyState icon="✅" title="ไม่มีรายการที่จะหมดใน 21 วันข้างหน้า" sub="คำนวณจากอัตราการใช้ปัจจุบันกับยอดคงเหลือรวม (หน้างาน + substock)" />
              )}
            </div>
          </>
        )}

        {state.reportTab === 'disc' && (
          <>
            <SearchInput value={discSearch} onChange={setDiscSearch} placeholder="ค้นหาชื่อยาในประวัตินี้" style={{ marginBottom: 9 }} />
            <div style={{ display: 'flex', gap: 7, marginBottom: 11, overflowX: 'auto', paddingBottom: 2 }}>
              <button className="chip" style={chip(discFilter === 'all')} onClick={() => setDiscFilter('all')}>ทั้งหมด</button>
              {DISC_TYPES.map((t) => (
                <button key={t} className="chip" style={chip(discFilter === t)} onClick={() => setDiscFilter(t)}>{DISC_TYPE_LABEL[t]}</button>
              ))}
            </div>
            <div className="card stagger" style={{ overflow: 'hidden' }}>
              {discRows.map((x) => {
                const Row: 'button' | 'div' = x.medId ? 'button' : 'div';
                return (
                  <Row
                    key={x.id}
                    {...(x.medId ? { onClick: () => goSubstockCardFor(x.medId!), className: 'row-interactive', title: 'ดูบัตรสต็อกยานี้' } : {})}
                    style={{ display: 'block', width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, color: 'var(--ink)' }}>{x.name}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: x.qty < 0 ? 'var(--red)' : 'var(--green)', flex: 'none' }}>{(x.qty > 0 ? '+' : '') + nf(x.qty) + ' ' + x.unit}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>{thDate(x.ts)} · {x.by} · {x.loc === 'floor' ? 'หน้างาน' : 'substock'}</div>
                    <div style={{ fontSize: 12, marginTop: 3, color: 'var(--ink)' }}>เหตุผล: {(x.reason || '—') + (x.note && x.note !== '—' ? ' — ' + x.note : '')}</div>
                  </Row>
                );
              })}
              {discRows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่พบรายการที่ตรงกับตัวกรอง</div>}
            </div>
          </>
        )}

        {state.reportTab === 'kpi' && (
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

            {kpiLoaded && !kpiLoading && kpiRows.length === 0 && (
              <EmptyState icon="📅" title="ยังไม่มีข้อมูลในช่วงนี้" sub="ระบบเก็บ snapshot วันละ 1 ครั้งอัตโนมัติ — ถ้าเพิ่งเริ่มใช้ระบบนี้ ให้รอสักวันหรือลองเลือกช่วงวันที่ใหม่กว่านี้" />
            )}

            {kpiRows.length > 0 && (
              <>
                <button
                  onClick={() => exportDailyMetricsCsv(kpiRows)}
                  className="btn-outline"
                  style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 44, marginBottom: 14 }}
                >
                  ↓ Export CSV — {nf(kpiRows.length)} วัน ({kpiFrom} ถึง {kpiTo})
                </button>

                <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
                  <ExecStat label="มูลค่าคงคลังล่าสุด" value={kpiLast ? nf(Math.round(kpiLast.totalStockValue)) + ' บาท' : '—'} note={kpiLast ? 'ณ ' + kpiLast.date : undefined} />
                  <ExecStat label="รับเข้ารวมช่วงนี้" value={nf(kpiSum((r) => r.receivedQty))} note={nf(kpiSum((r) => r.receivedCount)) + ' ครั้ง'} />
                  <ExecStat label="จ่ายจริงรวม (HOSxP)" value={nf(kpiSum((r) => r.dispensedQty))} note={kpiReconcileMissedDays > 0 ? kpiReconcileMissedDays + ' วันไม่ได้ตัดยอด' : 'ตัดยอดครบทุกวัน'} tone={kpiReconcileMissedDays > 0 ? 'var(--amber)' : undefined} />
                  <ExecStat
                    label="par ผิดพลาดล่าสุด"
                    value={kpiLast ? nf(kpiLast.parErrorCount) + ' รายการ' : '—'}
                    note={kpiLast ? 'ควรทบทวนอีก ' + nf(kpiLast.parReviewCount) : undefined}
                    tone={kpiLast && kpiLast.parErrorCount > 0 ? 'var(--red)' : 'var(--green)'}
                  />
                </div>

                <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em', margin: '0 2px 8px', textTransform: 'uppercase' }}>แนวโน้มรายวัน</div>
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One headline number for the ภาพรวมผู้บริหาร tab — deliberately plainer than HomeScreen's
 * StatTile (no icon, no click target): this screen is meant to be scanned/printed as a report,
 * not tapped through as a dashboard. */
function ExecStat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: '13px 13px 12px' }}>
      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.15, color: tone || 'var(--ink)', letterSpacing: '-.01em' }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 5, lineHeight: 1.4 }}>{label}</div>
      {note && <div className="muted" style={{ fontSize: 10.5, marginTop: 1, lineHeight: 1.4 }}>{note}</div>}
    </div>
  );
}
