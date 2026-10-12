import { useApp } from '../store/AppContext';
import { useEffect, useMemo, useRef, useState } from 'react';
import { subQty, daysUntil, usageAnomalies, daysOfStockLeft, categoryStats, dailyUsageRate, toneFor, topUsageByMed, usageByCategory, usageByMonth, leadTimeTrend, recurringStockouts, parAdjustmentOutcomes, discrepancyByCategory, repeatAdrReturns, frequentFloorRefills } from '../store/selectors';
import { nf, isoDate, fiscalYearStartIso, DAY } from '../utils/format';
import type { DailyMetrics, UsageHistoryRecord, ParAdjustmentRecord, DrugReturnRecord, MedId } from '../types';
import { TABS, REPORT_NAMES, AGING_BUCKETS, DISC_TYPES, chip } from './report/shared';
import { ExecTab } from './report/ExecTab';
import { AgingTab } from './report/AgingTab';
import { CategoryTab } from './report/CategoryTab';
import { TurnTab } from './report/TurnTab';
import { InsightsTab } from './report/InsightsTab';
import { DiscTab } from './report/DiscTab';
import { KpiTab } from './report/KpiTab';
import { UsageTab } from './report/UsageTab';
import { ReturnsTab } from './report/ReturnsTab';
import { StockAsOfTab } from './report/StockAsOfTab';

export default function ReportScreen() {
  const {
    state, setReportTab, exportReportCsv, exportAllReports, printExecutiveSummary, goSubstockCardFor, fetchExecTxsThisMonth,
    fetchDailyMetrics, exportDailyMetricsCsv, fetchUsageHistory, exportUsageHistoryCsv, fetchParAdjustments, fetchStockAsOf, exportStockAsOfCsv, fetchDrugReturns, exportDrugReturnsCsv, userName, toast,
  } = useApp();
  // Discrepancy log had no way to narrow it down — always the same fixed most-recent-30 slice
  // of state.txs, with no type filter and no way to find one specific drug's history, unlike
  // AdminScreen's audit log right next door which has both. Same underlying data (the live
  // txs feed), same treatment now: a type filter and a name search, both client-side since
  // state.txs is already the same capped-300 realtime cache AdminScreen reads from.
  const [discFilter, setDiscFilter] = useState<string>('all');
  const [discSearch, setDiscSearch] = useState('');
  // OPD/IPD ward tabs removed — reports always cover the whole formulary.
  // Memoized so buckets/riskValue's own useMemo below actually holds across an unrelated
  // re-render (e.g. typing in discSearch) instead of seeing a new array reference every time.
  const meds = useMemo(() => state.meds.filter((m) => m.active), [state.meds]);

  // Bug fix (performance): wardLots/buckets/riskValue used to look up each lot's med via
  // meds.find() — a linear scan of the whole active-meds array PER LOT, across 5 aging buckets
  // plus riskValue, so effectively O(6 × lots × meds). At real hospital scale (~500+ meds,
  // 1000+ lots) that's several million comparisons, and none of it was memoized — retyping a
  // single character in the unrelated Discrepancy-log search box (discSearch, a plain useState
  // on this same component) re-ran all of it every keystroke even while viewing a completely
  // different tab. medById (a Map, same fix categoryStats()/subQty() already use elsewhere)
  // turns each lookup into O(1); wrapping in useMemo keyed on the actual underlying data means
  // it only recomputes when state.meds/state.lots/expiryWarnDays actually change.
  const medById = useMemo(() => new Map(meds.map((m) => [m.id, m])), [meds]);
  const wardLots = useMemo(() => {
    const medIds = new Set(meds.map((m) => m.id));
    return state.lots.filter((l) => medIds.has(l.medId));
  }, [state.lots, meds]);
  const buckets = useMemo(() => AGING_BUCKETS.map(([label, lo, hi, fg]) => {
    const ls = wardLots.filter((l) => l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
    const value = ls.reduce((s, l) => s + l.qty * (medById.get(l.medId)?.price || 0), 0);
    return { label, fg, lots: ls.length, value };
  }), [wardLots, medById]);
  const maxVal = Math.max(1, ...buckets.map((b) => b.value));
  // Bug fix (data correctness): this used to always sum the first 3 fixed AGING_BUCKETS
  // (expired + ≤30 + 31–90 days), regardless of what state.expiryWarnDays actually is — the
  // exec tile's own label right next to this number ("มูลค่าเสี่ยงหมดอายุ ≤ {expiryWarnDays}
  // วัน") already reads the real, admin-configurable setting, so changing it in Settings moved
  // the label but silently left the number still fixed at "≤90 days", over/undercounting real
  // near-expiry risk value by however far the setting differs from 90. Every other consumer of
  // this exact same "at-risk" concept — categoryStats()'s atRisk field, printExecutiveSummary()'s
  // own riskValue (AppContext.tsx) — already scopes to `daysUntil(l.exp) <= expiryWarnDays`;
  // this is the one place that didn't, so it silently disagreed with both.
  const riskValue = useMemo(() => wardLots.reduce((s, l) => {
    const m = medById.get(l.medId);
    return m && l.qty > 0 && daysUntil(l.exp) <= state.expiryWarnDays ? s + l.qty * m.price : s;
  }, 0), [wardLots, medById, state.expiryWarnDays]);

  // ---------- ภาพรวมผู้บริหาร (exec tab) ----------
  // Same underlying numbers aging/turn/category already compute above — this just rolls them
  // into one headline-first view a pharmacy head/PTC reader can scan without visiting every tab.
  // Bug fix (performance audit): exec/insights-tab computations below used to be plain
  // `const`s recomputed in full on every render — unlike the aging-tab ones just above (already
  // fixed, see this file's own "Bug fix (performance)" comment), these ran on every render
  // regardless of tab, including every keystroke in the unrelated discSearch box. subQty()/
  // categoryStats()/daysOfStockLeft() only ever read state.lots (verified in selectors.ts), so
  // depending on [meds, state.lots, ...] — never the whole `state` object, which is a new
  // reference on every patch() anywhere in the app — is what lets this actually skip
  // recomputation on an unrelated render.
  const execHealthy = useMemo(() => meds.filter((m) => toneFor(m) === 'var(--green)').length, [meds]);
  const execWarn = useMemo(() => meds.filter((m) => toneFor(m) === 'var(--amber)').length, [meds]);
  const execCritical = meds.length - execHealthy - execWarn;
  const execHealthyPct = meds.length ? Math.round((execHealthy / meds.length) * 100) : 100;
  const execTotalValue = useMemo(() => meds.reduce((s, m) => s + (m.floor + subQty(state, m.id)) * m.price, 0), [meds, state.lots]);
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
  const execByValue = useMemo(() => meds
    .map((m) => ({ m, oh: m.floor + subQty(state, m.id), value: (m.floor + subQty(state, m.id)) * m.price }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10), [meds, state.lots]);
  const execByUsage = useMemo(() => meds
    .filter((m) => m.used30 > 0)
    .slice()
    .sort((a, b) => b.used30 - a.used30)
    .slice(0, 10), [meds]);

  const turnRate = (m: (typeof meds)[number]) => m.used30 / Math.max(1, m.parFloor);
  const turnRows = useMemo(() => meds
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [meds, state.lots]);

  // Per-therapeutic-group rollup — the report the drug categories added in v3.2.0 were
  // ultimately for: which groups tie up the most money, which are running low across the
  // board, and which have expiry risk concentrated in them. Same pure selector the CSV export
  // uses, so the exported spreadsheet can never disagree with what's on screen.
  const catRows = useMemo(() => categoryStats(state, meds, state.expiryWarnDays), [meds, state.lots, state.expiryWarnDays]);
  const catMaxValue = Math.max(1, ...catRows.map((r) => r.value));
  // Bug fix (report accuracy): each row displays nf(r.value) — Math.round to the nearest whole
  // baht — but the footer used to sum the RAW, unrounded values and round only that final sum.
  // Real seed data hits this exactly: a ฿1.50 med × qty 7 = ฿10.50 (displayed "11 บาท") in one
  // category, a ฿2.25 med × qty 2 = ฿4.50 (displayed "5 บาท") in another — rows read 11 + 5 = 16,
  // but the raw sum 10.50 + 4.50 = 15.00 rounds to "15 บาท" in the footer. A PTC/pharmacy-head
  // reviewer adding up the printed rows by hand gets a different total than the report itself.
  // Summing the already-rounded per-row values instead guarantees the footer always equals
  // exactly what a reader would get by adding up the rows they can actually see.
  const catTotalValue = catRows.reduce((s2, r) => s2 + Math.round(r.value), 0);

  // Bug fix (performance audit): discByCategory/repeatAdr depend only on discAllTyped/meds —
  // never on discFilter/discSearch below — but used to recompute on every keystroke in the
  // Discrepancy-log search box regardless, since nothing here was memoized.
  const discAllTyped = useMemo(() => state.txs.filter((x) => DISC_TYPES.indexOf(x.type) >= 0), [state.txs]);
  const discQ = discSearch.trim().toLowerCase();
  const discRows = useMemo(() => discAllTyped
    .filter((x) => discFilter === 'all' || x.type === discFilter)
    .filter((x) => !discQ || x.name.toLowerCase().indexOf(discQ) >= 0)
    .slice(0, 60), [discAllTyped, discFilter, discQ]);
  // Real-world request: "หมวดไหนเสียบ่อยผิดปกติ" — off `discAllTyped` (the whole recent
  // discrepancy-type dataset), deliberately NOT `discRows` (the user's own current type/search
  // filter on the Discrepancy-log tab) — a pattern insight should reflect the real picture
  // regardless of whatever filter someone happens to have picked on a different tab.
  const discByCategory = useMemo(() => discrepancyByCategory(discAllTyped, meds), [discAllTyped, meds]);
  const discByCategoryTotal = discByCategory.reduce((s2, c) => s2 + c.count, 0);
  // Same `discAllTyped` input as discByCategory above — the whole recent discrepancy-type
  // dataset, not whatever filter the Discrepancy-log tab's own type/search picker happens to have.
  const repeatAdr = useMemo(() => repeatAdrReturns(discAllTyped, meds), [discAllTyped, meds]);

  // "🧠 วิเคราะห์อัตโนมัติ" — real numbers computed on-device from usage data already synced
  // (used30/usedPrev30 from recomputeUsageStats/commitUsageImport), not a call to any AI
  // service — this app is a static site with no backend to hold an API key safely, so an
  // actual LLM call from here would mean shipping that key in public client code. Two useful
  // things fall straight out of data already on hand: which drugs' usage swung sharply enough
  // to need attention, and which are projected to run out soonest at their current pace.
  const anomalies = useMemo(() => usageAnomalies(meds), [meds]);
  const stockoutRows = useMemo(() => meds
    .map((m) => ({ m, days: daysOfStockLeft(state, m) }))
    .filter((x): x is { m: (typeof meds)[number]; days: number } => x.days !== null && x.days <= 21)
    .sort((a, b) => a.days - b.days)
    .slice(0, 20), [meds, state.lots]);

  // ---------- เสถียรภาพการเบิก/เติมยา (also "🧠 วิเคราะห์อัตโนมัติ" tab) ----------
  // Real-world request: "ทำยังไงให้การเบิกเติมยาเสถียรที่สุด" — two one-shot fetches, local to
  // this screen same as the kpi/usage tabs' own fetched-on-open ranges, firing together the
  // first time this tab opens (not gated behind a separate button — these are meant to surface
  // automatically, the whole point of a proactive alert).
  const [stabilityRows, setStabilityRows] = useState<DailyMetrics[]>([]);
  const [parOutcomeRecords, setParOutcomeRecords] = useState<ParAdjustmentRecord[]>([]);
  const [stabilityLoaded, setStabilityLoaded] = useState(false);
  useEffect(() => {
    if (state.reportTab !== 'insights' || stabilityLoaded) return;
    setStabilityLoaded(true);
    // Bug fix (audit finding): neither fetch had a .catch — on a slow/flaky connection
    // (withTimeout's 15s ceiling, or any other getDocs failure), this used to be an unhandled
    // promise rejection with no toast, AND stabilityLoaded stayed stuck true forever, so the
    // lead-time/stockout-streak/frequent-refill/par-outcome cards silently stayed empty for the
    // rest of the session — switching tabs away and back never retried, only a full page reload
    // did. Resetting stabilityLoaded to false on failure gives this the same "reopen the tab to
    // retry" path the kpi tab's loadKpi already has (its kpiLoaded also only ever becomes true
    // on success).
    Promise.all([
      fetchDailyMetrics(isoDate(Date.now() - 29 * DAY), isoDate(Date.now())),
      fetchParAdjustments(Date.now() - 60 * DAY),
    ]).then(([dmRows, parRows]) => {
      setStabilityRows(dmRows);
      setParOutcomeRecords(parRows);
    }).catch((e) => {
      toast((e as Error)?.message || 'โหลดข้อมูลวิเคราะห์อัตโนมัติไม่สำเร็จ ลองเปิดแท็บนี้ใหม่อีกครั้ง');
      setStabilityLoaded(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reportTab, stabilityLoaded]);
  const leadTime = leadTimeTrend(stabilityRows);
  const stockoutStreaks = recurringStockouts(stabilityRows, meds);
  const frequentRefills = frequentFloorRefills(stabilityRows, meds);
  const parOutcomes = parAdjustmentOutcomes(parOutcomeRecords, meds);
  const parOutcomesVolatile = parOutcomes.filter((o) => o.status === 'still_volatile');
  const parOutcomesStable = parOutcomes.filter((o) => o.status === 'stable');

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
  // Bug fix (stale report silently shown): no request-id guard here meant two overlapping
  // fetchDailyMetrics calls (e.g. the mount effect firing, then the user changes the date
  // range and hits "ดึงรางาน" again before the first resolves) could resolve out of order —
  // whichever finished LAST won, even if it was for a range the user no longer has selected.
  // The date inputs stayed visually correct throughout while the table/CSV/print underneath
  // silently held a different range's data, with nothing on screen to reveal the mismatch.
  // Same "last request wins" ref-counter pattern SubstockCardScreen already uses for its own
  // fetch race — only the request that's still the newest when it resolves gets applied.
  const kpiReqId = useRef(0);
  const loadKpi = () => {
    const reqId = ++kpiReqId.current;
    setKpiLoading(true);
    fetchDailyMetrics(kpiFrom, kpiTo).then((rows) => {
      if (reqId !== kpiReqId.current) return;
      setKpiRows(rows); setKpiLoaded(true);
    }).catch((e) => {
      // Bug fix (resilience audit): same unhandled-rejection + silent-failure shape the
      // insights-tab fetch above was already fixed for (see its own "Bug fix" comment) — this
      // one never had the matching .catch, so a timeout/offline error here left the table
      // silently empty forever with no toast and no retry short of a full page reload.
      if (reqId !== kpiReqId.current) return;
      toast((e as Error)?.message || 'โหลดข้อมูลตัวชี้วัดย้อนหลังไม่สำเร็จ ลองเปิดแท็บนี้ใหม่อีกครั้ง');
      setKpiLoaded(false);
    }).finally(() => { if (reqId === kpiReqId.current) setKpiLoading(false); });
  };
  useEffect(() => {
    if (state.reportTab === 'kpi' && !kpiLoaded) loadKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reportTab]);
  const kpiSum = (f: (r: DailyMetrics) => number) => kpiRows.reduce((s, r) => s + f(r), 0);
  const kpiLast = kpiRows[kpiRows.length - 1];
  // `?? 0` here (unlike kpiSum's other callers): damagedLossValue/expiredLossValue are optional
  // fields (see their own doc comment in types.ts) — a dailyMetrics doc written before this
  // field existed has neither, and `undefined` through a plain `+` would turn the WHOLE range's
  // sum into NaN the moment one old day's doc is included.
  const kpiDamagedLossSum = kpiSum((r) => r.damagedLossValue ?? 0);
  const kpiExpiredLossSum = kpiSum((r) => r.expiredLossValue ?? 0);
  const kpiReconcileMissedDays = kpiRows.filter((r) => !r.reconciledToday).length;
  // Rate (not a stored/averaged percentage) recomputed from the latest day's raw counts — a
  // rate averaged across days would be wrong the moment usedMedCount itself changes day to day.
  const kpiStockoutRatePct = kpiLast && kpiLast.usedMedCount > 0 ? (kpiLast.stockoutCount / kpiLast.usedMedCount) * 100 : null;
  // Weighted (not simple) average across the range — a day with 1 approval and a day with 20
  // must not count equally toward the overall figure.
  const kpiLeadTimeWeightedHours = (() => {
    const totalApproved = kpiSum((r) => r.receiveApprovedCount);
    if (totalApproved === 0) return null;
    const totalHours = kpiRows.reduce((s, r) => s + (r.receiveLeadTimeAvgHours ?? 0) * r.receiveApprovedCount, 0);
    return totalHours / totalApproved;
  })();

  // ---------- 📈 สถิติการใช้ยา (usage tab) ----------
  // Real-world request: "เก็บสถิติการใช้ยาแต่ละวัน...รายงานประจำไตรมาส/เดือน/ปีงบประมาณ...Top 100"
  // — same "own date range + fetched rows, local to this screen" shape as the kpi tab right
  // above (a bounded historical query, not part of the always-live global state). Defaults to
  // the current fiscal year (ต.ค.–ปัจจุบัน) since that's the period a pharmacy actually reports
  // against, not a rolling 30 days.
  const [usageFrom, setUsageFrom] = useState(() => fiscalYearStartIso(Date.now()));
  const [usageTo, setUsageTo] = useState(() => isoDate(Date.now()));
  const [usageRecords, setUsageRecords] = useState<UsageHistoryRecord[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageLoaded, setUsageLoaded] = useState(false);
  const [usageRankBy, setUsageRankBy] = useState<'value' | 'qty'>('value');
  // Same "last request wins" ref-counter guard as kpiReqId above — see its own comment for why.
  const usageReqId = useRef(0);
  const loadUsage = () => {
    const reqId = ++usageReqId.current;
    setUsageLoading(true);
    fetchUsageHistory(usageFrom, usageTo).then((records) => {
      if (reqId !== usageReqId.current) return;
      setUsageRecords(records); setUsageLoaded(true);
    }).catch((e) => {
      // Bug fix (resilience audit): same gap as loadKpi above — no .catch meant a fetch
      // failure here silently left this tab empty forever with no toast.
      if (reqId !== usageReqId.current) return;
      toast((e as Error)?.message || 'โหลดสถิติการใช้ยาไม่สำเร็จ ลองเปิดแท็บนี้ใหม่อีกครั้ง');
      setUsageLoaded(false);
    }).finally(() => { if (reqId === usageReqId.current) setUsageLoading(false); });
  };
  useEffect(() => {
    if (state.reportTab === 'usage' && !usageLoaded) loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reportTab]);
  const usageTopMeds = useMemo(() => topUsageByMed(usageRecords, usageRankBy, 100), [usageRecords, usageRankBy]);
  const usageCategoryRows = useMemo(() => usageByCategory(usageRecords), [usageRecords]);
  const usageMonthRows = useMemo(() => usageByMonth(usageRecords), [usageRecords]);
  const usageTotalQty = usageRecords.reduce((s, r) => s + r.qty, 0);
  // Bug fix (report accuracy, audit finding): same class of mismatch catTotalValue above was
  // already fixed for — summing RAW per-row values and rounding only the final sum can disagree
  // with what a reader gets by adding up the rounded values actually shown in the Top 100 table
  // (TopUsageByMed rows display nf(r.value), i.e. Math.round each). Summing already-rounded
  // values guarantees the footer matches the rows a reader can actually see adding up.
  const usageTotalValue = usageRecords.reduce((s, r) => s + Math.round(r.value), 0);
  const usageMedCount = usageTopMeds.length;

  // ---------- ↩️ รายงานคืนยา (returns tab) ----------
  // Real-world request: "สามารถดึงรายงานข้อมูลยาคืนได้ทุกช่วง เพื่อนำข้อมูลไปวิเคราะห์ต่อได้" —
  // same "own date range + fetched rows, local to this screen" shape as the usage tab above.
  // Defaults to the current month rather than the fiscal year, since a return log is reviewed
  // much more often/granularly than a yearly usage report.
  const [rtnFrom, setRtnFrom] = useState(() => isoDate(Date.now()).slice(0, 8) + '01');
  const [rtnTo, setRtnTo] = useState(() => isoDate(Date.now()));
  const [rtnRecords, setRtnRecords] = useState<DrugReturnRecord[]>([]);
  const [rtnLoading, setRtnLoading] = useState(false);
  const [rtnLoaded, setRtnLoaded] = useState(false);
  const rtnReqId = useRef(0);
  const loadReturns = () => {
    const reqId = ++rtnReqId.current;
    setRtnLoading(true);
    fetchDrugReturns(rtnFrom, rtnTo).then((records) => {
      if (reqId !== rtnReqId.current) return;
      setRtnRecords(records); setRtnLoaded(true);
    }).catch((e) => {
      // Bug fix (resilience audit): same gap as loadKpi above — no .catch meant a fetch
      // failure here silently left this tab empty forever with no toast.
      if (reqId !== rtnReqId.current) return;
      toast((e as Error)?.message || 'โหลดรายงานคืนยาไม่สำเร็จ ลองเปิดแท็บนี้ใหม่อีกครั้ง');
      setRtnLoaded(false);
    }).finally(() => { if (reqId === rtnReqId.current) setRtnLoading(false); });
  };
  useEffect(() => {
    if (state.reportTab === 'returns' && !rtnLoaded) loadReturns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reportTab]);
  const rtnTotalQty = rtnRecords.reduce((s, r) => s + r.qty, 0);
  const rtnTotalValue = rtnRecords.reduce((s, r) => s + Math.round(r.value), 0);

  // ---------- 📜 ยอดคงคลังย้อนหลัง (stockasof tab) ----------
  // Real-world request: "ดูยอดคงคลังย้อนหลังได้เสมอ เหมือน HOSxP" — a single-date fetch (not a
  // range like kpi/usage above), since this reconstructs a POINT-IN-TIME snapshot, not a trend
  // over a period. Defaults to today (same as a live view, useful as a sanity check against the
  // real floor/subQty numbers elsewhere in the app before trusting an older date).
  const [stockAsOfDate, setStockAsOfDate] = useState(() => isoDate(Date.now()));
  const [stockAsOfRows, setStockAsOfRows] = useState<{ medId: MedId; medName: string; unit: string; category: string; floor: number; sub: number; value: number }[]>([]);
  const [stockAsOfLoading, setStockAsOfLoading] = useState(false);
  const [stockAsOfLoaded, setStockAsOfLoaded] = useState(false);
  const [stockAsOfSearch, setStockAsOfSearch] = useState('');
  const stockAsOfReqId = useRef(0);
  const loadStockAsOf = () => {
    const reqId = ++stockAsOfReqId.current;
    setStockAsOfLoading(true);
    // End-of-day (23:59:59.999) so the picked DATE's own transactions are included in "up to
    // and including" that day, matching how every other date-range picker in this app treats
    // its "ถึงวันที่" bound.
    const dateMs = new Date(stockAsOfDate + 'T23:59:59.999').getTime();
    fetchStockAsOf(dateMs).then((rows) => {
      if (reqId !== stockAsOfReqId.current) return;
      setStockAsOfRows(rows); setStockAsOfLoaded(true);
    }).catch((e) => {
      // Bug fix (resilience audit): same gap as loadKpi above — no .catch meant a fetch
      // failure here silently left this tab empty forever with no toast.
      if (reqId !== stockAsOfReqId.current) return;
      toast((e as Error)?.message || 'โหลดยอดคงคลังย้อนหลังไม่สำเร็จ ลองเปิดแท็บนี้ใหม่อีกครั้ง');
      setStockAsOfLoaded(false);
    }).finally(() => { if (reqId === stockAsOfReqId.current) setStockAsOfLoading(false); });
  };
  useEffect(() => {
    if (state.reportTab === 'stockasof' && !stockAsOfLoaded) loadStockAsOf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.reportTab]);
  const stockAsOfFiltered = useMemo(() => {
    const q = stockAsOfSearch.trim().toLowerCase();
    const rows = q ? stockAsOfRows.filter((r) => r.medName.toLowerCase().includes(q)) : stockAsOfRows;
    return rows.slice().sort((a, b) => b.value - a.value);
  }, [stockAsOfRows, stockAsOfSearch]);
  // Bug fix (report accuracy, audit finding): same class of mismatch catTotalValue was already
  // fixed for — this table shows every med in the formulary (not just a Top N), so a PTC/
  // pharmacy-head reviewer adding up the visible rows by hand is exactly the real scenario that
  // fix's own comment describes. Summing already-rounded per-row values (matching what the table
  // below actually displays via nf(r.value)) guarantees the footer always agrees with them.
  const stockAsOfTotalValue = stockAsOfRows.reduce((s, r) => s + Math.round(r.value), 0);
  const stockAsOfNegativeCount = stockAsOfRows.filter((r) => r.floor < 0 || r.sub < 0).length;

  return (
    <div style={{ animation: 'fade .18s' }}>
      <div style={{ padding: '12px 14px 10px', position: 'sticky', top: 0, zIndex: 2 }} className="sticky-bar">
        <div className="scroll-fade-x" style={{ display: 'flex', gap: 7, overflowX: 'auto', marginBottom: 9 }}>
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
        {/* "kpi"/"usage"/"stockasof" each have their own date-scoped export below
            (exportDailyMetricsCsv / exportUsageHistoryCsv / exportStockAsOfCsv on their own
            fetched rows) — the generic exportReportCsv here only ever knows how to export
            whatever's in state right now, which doesn't make sense for a historical range. */}
        {state.reportTab !== 'kpi' && state.reportTab !== 'usage' && state.reportTab !== 'stockasof' && state.reportTab !== 'returns' && (
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
          <ExecTab
            execTotalValue={execTotalValue}
            execHealthyPct={execHealthyPct}
            execCritical={execCritical}
            execWarn={execWarn}
            riskValue={riskValue}
            expiryWarnDays={state.expiryWarnDays}
            execTxsThisMonth={execTxsThisMonth}
            medCount={meds.length}
            execByValue={execByValue}
            execByUsage={execByUsage}
            goSubstockCardFor={goSubstockCardFor}
          />
        )}

        {state.reportTab === 'aging' && (
          <AgingTab buckets={buckets} maxVal={maxVal} riskValue={riskValue} expiryWarnDays={state.expiryWarnDays} />
        )}

        {state.reportTab === 'category' && (
          <CategoryTab catRows={catRows} catMaxValue={catMaxValue} catTotalValue={catTotalValue} expiryWarnDays={state.expiryWarnDays} />
        )}

        {state.reportTab === 'turn' && (
          <TurnTab turnRows={turnRows} goSubstockCardFor={goSubstockCardFor} />
        )}

        {state.reportTab === 'insights' && (
          <InsightsTab
            anomalies={anomalies}
            stockoutRows={stockoutRows}
            leadTime={leadTime}
            stockoutStreaks={stockoutStreaks}
            frequentRefills={frequentRefills}
            parOutcomes={parOutcomes}
            parOutcomesVolatile={parOutcomesVolatile}
            parOutcomesStable={parOutcomesStable}
            discByCategoryTotal={discByCategoryTotal}
            discByCategory={discByCategory}
            repeatAdr={repeatAdr}
            goSubstockCardFor={goSubstockCardFor}
          />
        )}

        {state.reportTab === 'disc' && (
          <DiscTab
            discSearch={discSearch}
            setDiscSearch={setDiscSearch}
            discFilter={discFilter}
            setDiscFilter={setDiscFilter}
            discRows={discRows}
            goSubstockCardFor={goSubstockCardFor}
          />
        )}

        {state.reportTab === 'kpi' && (
          <KpiTab
            kpiFrom={kpiFrom} setKpiFrom={setKpiFrom} kpiTo={kpiTo} setKpiTo={setKpiTo}
            kpiRows={kpiRows} kpiLoading={kpiLoading} kpiLoaded={kpiLoaded} loadKpi={loadKpi}
            kpiLast={kpiLast} kpiSum={kpiSum} kpiDamagedLossSum={kpiDamagedLossSum} kpiExpiredLossSum={kpiExpiredLossSum}
            kpiReconcileMissedDays={kpiReconcileMissedDays} kpiStockoutRatePct={kpiStockoutRatePct} kpiLeadTimeWeightedHours={kpiLeadTimeWeightedHours}
            exportDailyMetricsCsv={exportDailyMetricsCsv} userName={userName} toast={toast}
          />
        )}

        {state.reportTab === 'usage' && (
          <UsageTab
            usageFrom={usageFrom} setUsageFrom={setUsageFrom} usageTo={usageTo} setUsageTo={setUsageTo}
            usageRecords={usageRecords} usageLoading={usageLoading} usageLoaded={usageLoaded} loadUsage={loadUsage}
            usageRankBy={usageRankBy} setUsageRankBy={setUsageRankBy} usageTopMeds={usageTopMeds}
            usageCategoryRows={usageCategoryRows} usageMonthRows={usageMonthRows} usageTotalQty={usageTotalQty}
            usageTotalValue={usageTotalValue} usageMedCount={usageMedCount} exportUsageHistoryCsv={exportUsageHistoryCsv}
          />
        )}

        {state.reportTab === 'returns' && (
          <ReturnsTab
            rtnFrom={rtnFrom} setRtnFrom={setRtnFrom} rtnTo={rtnTo} setRtnTo={setRtnTo}
            rtnRecords={rtnRecords} rtnLoading={rtnLoading} rtnLoaded={rtnLoaded} loadReturns={loadReturns}
            rtnTotalValue={rtnTotalValue} rtnTotalQty={rtnTotalQty} exportDrugReturnsCsv={exportDrugReturnsCsv}
          />
        )}

        {state.reportTab === 'stockasof' && (
          <StockAsOfTab
            stockAsOfDate={stockAsOfDate} setStockAsOfDate={setStockAsOfDate}
            stockAsOfLoading={stockAsOfLoading} stockAsOfLoaded={stockAsOfLoaded} loadStockAsOf={loadStockAsOf}
            stockAsOfRows={stockAsOfRows} stockAsOfTotalValue={stockAsOfTotalValue} stockAsOfNegativeCount={stockAsOfNegativeCount}
            stockAsOfSearch={stockAsOfSearch} setStockAsOfSearch={setStockAsOfSearch} stockAsOfFiltered={stockAsOfFiltered}
            goSubstockCardFor={goSubstockCardFor} exportStockAsOfCsv={exportStockAsOfCsv}
          />
        )}
      </div>
    </div>
  );
}
