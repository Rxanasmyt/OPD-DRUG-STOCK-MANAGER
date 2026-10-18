#!/usr/bin/env node
// Real-world request: "วิเคราะห์ระบบ Min Max...ให้เหมาะกับการใช้งานหน้างานจริง" — used30/usedPrev30
// (the ONLY inputs suggestPar()'s whole Min/Max/par substock calculation reads — see
// src/store/selectors.ts) used to be recomputed from real HOSxP dispensing history purely by a
// manual "คำนวณสถิติการใช้ใหม่จากประวัติ HOSxP ↺" button in SettingsScreen (AppContext.tsx's
// recomputeUsageStats()) — if nobody remembered to click it, every par suggestion in the app kept
// aging off whatever usage rate happened to be on record, with no signal anywhere that it had
// gone stale. This script is the exact same aggregation, run automatically every day instead of
// depending on a person remembering a button — the manual button still exists (useful right after
// a big HOSxP catch-up import), this just means par suggestions never go more than a day stale on
// their own.
//
// Real-world request (this round): "อยากให้รันอัตโนมัติ โดยไม่ต้องพึ่งคนกด เนื่องจากบางทีลืมกดทำให้
// min max par ไม่ปรับตามการใช้ยาจริง" — the SAME problem existed for the OTHER manual button in
// SettingsScreen, "วิเคราะห์รูปแบบการใช้ยารายวัน/วันจ่ายสูงสุด ↺" (analyzeWeekdayUsage() in
// AppContext.tsx), which writes Med.weekdayPeakFactor/weekdayPeakDay/weekdayPeakOccurrences/
// weekdayPattern/peakDayQty/peakDayDate — every multiplier suggestPar() applies on TOP of the
// flat used30/usedPrev30 rate. This script now runs that SAME aggregation too, right after the
// one above, reusing the SAME already-fetched meds + reconcile_hosxp tx snapshot instead of
// issuing a second identical query against the same collection — one extra daily read of the same
// data for two outputs, not two (matters given this project's own history of Firestore free-tier
// quota incidents — see CHANGELOG.md's PR #116-121 entries). Hand-kept in sync with
// analyzeWeekdayUsage() (src/store/AppContext.tsx) — same bangkokWeekday/isoDate Bangkok-anchored
// date math (src/utils/format.ts), same 91/180-day lookback windows, same confidence thresholds.
// If either source function's logic changes, update here too (same convention every other script
// in this directory already follows for its in-app counterpart).
//
// Neither half of this script writes an audit-log entry (admin SDK writes bypass the app's
// logAudit() helper entirely) — same as this script always has for used30/usedPrev30; only the
// manual in-app buttons log to auditLog, same precedent.
//
// Run automatically every day by .github/workflows/recompute-usage-stats.yml. To run locally:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/recompute-usage-stats.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const DAY = 24 * 60 * 60 * 1000;

// Same fixed-UTC+7-offset trick as src/utils/format.ts's bangkokWeekday()/isoDate() — Thailand has
// no DST, so this gives the correct Bangkok wall-clock weekday/calendar-day for any real UTC
// instant regardless of what timezone this script's own host happens to run in (GitHub Actions
// runners are UTC, but this keeps the two implementations provably equivalent rather than relying
// on that).
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
function bangkokWeekday(ms) {
  return new Date(ms + BANGKOK_OFFSET_MS).getUTCDay(); // 0=อาทิตย์..6=เสาร์
}
function isoDate(ms) {
  const shifted = new Date(ms + BANGKOK_OFFSET_MS);
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth() + 1, d = shifted.getUTCDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Mirrors percentile() in src/store/selectors.ts exactly — see its own doc comment for the full
// "why" (a real-world report: METFORMIN - PL 500 mg., a single 11,514-เม็ด day driving Max
// straight to roundStep(11,514) via the old raw-peak clamp). Nearest-rank: sort ascending, pick
// the value at index ceil(p × n) − 1 (clamped into range) — always one of the real recorded
// values, never an interpolated number that was never actually dispensed.
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

// Mirrors coefficientOfVariation() in src/store/selectors.ts exactly — see Med.usageCv's own doc
// comment (src/types.ts) for the full "why" (replacing a hand-typed volatility guess with a real
// population coefficient of variation computed from actual per-day dispense history).
function coefficientOfVariation(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (!(mean > 0)) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  console.log(`Recomputing usage stats (project "${serviceAccount.project_id}")...`);

  const now = Date.now();
  // Bug fix (Firestore read volume): this used to query `where('type', '==', 'reconcile_hosxp')`
  // alone — every reconcile_hosxp tx this hospital has EVER logged, unbounded, growing by
  // roughly one row per active med per day forever, even though neither Part 1 (60-day bucket)
  // nor Part 2 (180-day peak window, the longer of its own two lookbacks — PEAK_LOOKBACK_DAYS
  // below) ever uses anything older than that. Bounding the query itself by `ts` instead (same
  // single-field range filter Firestore serves with no new composite index — combining it with
  // the `type` equality filter above would need one) cuts this script's one daily read down to
  // a fixed ~180-day window instead of this hospital's whole multi-year history. `type` is
  // filtered back out client-side below in both loops, restoring exactly what the removed
  // server-side filter used to guarantee. Mirrors the identical fix in recomputeUsageStats()/
  // analyzeWeekdayUsage() (src/store/AppContext.tsx) — kept in sync per this file's own header
  // comment's convention.
  const PEAK_LOOKBACK_DAYS_FOR_QUERY = 181; // the longer of Part 2's two windows (180) + 1-day pad
  const [medsSnap, txSnap] = await Promise.all([
    db.collection('meds').get(),
    db.collection('txs').where('ts', '>=', now - PEAK_LOOKBACK_DAYS_FOR_QUERY * DAY).get(),
  ]);
  const meds = medsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Same OPD/IPD name-twin hazard both halves below share — aggregating by name alone would sum
  // both wards' dispensing into one number and write that same (wrong) total onto both copies.
  const dupNames = new Set();
  const seenNames = new Set();
  for (const m of meds) {
    if (seenNames.has(m.name)) dupNames.add(m.name);
    seenNames.add(m.name);
  }
  const targets = meds.filter((m) => m.active);

  // ---------------------------------------------------------------------------------------------
  // Part 1: flat used30/usedPrev30 (30/60-day totals), plus dispenseDays30 (this round — see
  // Med.dispenseDays30's own doc comment, src/types.ts, for the full "why": a real-world report
  // of 100+ false-positive "ตัดไม่ครบ" items a day, almost all sporadically-used emergency/ICU
  // drugs that the old plain `used30 > 0` bar wrongly treated as "expected every day"). Tracks
  // the DISTINCT real calendar days (not raw tx count) each med got a reconcile_hosxp deduction
  // within the current 30-day bucket, spreading a multi-day covered batch across its real days
  // — same convention Part 2's weekday/peak-day maps below already use. Mirrors
  // recomputeUsageStats()'s identical fix (src/store/AppContext.tsx) — kept in sync per this
  // file's own header comment's convention.
  // ---------------------------------------------------------------------------------------------
  const curByName = {};
  const prevByName = {};
  const curById = {};
  const prevById = {};
  const curDaysByName = {};
  const curDaysById = {};
  for (const d of txSnap.docs) {
    const x = d.data();
    // txSnap is now `ts`-range-bounded but type-UNfiltered (see the comment at its own fetch
    // above) — every other tx type in this window must be excluded here, same as Part 2 below.
    if (x.type !== 'reconcile_hosxp') continue;
    if (!x.name || typeof x.qty !== 'number' || x.qty >= 0 || typeof x.ts !== 'number') continue; // only dispensed (negative) entries
    const ageDays = (now - x.ts) / DAY;
    if (ageDays < 0) continue;
    const bucket = ageDays <= 30 ? 30 : ageDays <= 60 ? 60 : 0;
    if (!bucket) continue;
    if (dupNames.has(x.name)) {
      if (!x.medId) continue;
      const map = bucket === 30 ? curById : prevById;
      map[x.medId] = (map[x.medId] || 0) + Math.abs(x.qty);
    } else {
      const map = bucket === 30 ? curByName : prevByName;
      map[x.name] = (map[x.name] || 0) + Math.abs(x.qty);
    }
    if (bucket !== 30) continue; // dispenseDays30 only ever covers the current 30-day bucket
    const fromIso = x.coveredFrom || isoDate(x.ts);
    const toIso = x.coveredTo || isoDate(x.ts);
    const fromTs = new Date(fromIso + 'T00:00:00').getTime();
    const toTs = new Date(toIso + 'T00:00:00').getTime();
    const daysCovered = Math.max(1, Math.round((toTs - fromTs) / DAY) + 1);
    for (let i = 0; i < daysCovered; i++) {
      const dayTs = fromTs + i * DAY;
      if (dayTs > now) continue;
      const dIso = isoDate(dayTs);
      if (dupNames.has(x.name)) {
        if (!x.medId) continue;
        if (!curDaysById[x.medId]) curDaysById[x.medId] = new Set();
        curDaysById[x.medId].add(dIso);
      } else {
        if (!curDaysByName[x.name]) curDaysByName[x.name] = new Set();
        curDaysByName[x.name].add(dIso);
      }
    }
  }

  let batch = db.batch();
  let opsInBatch = 0;
  let written = 0;
  for (const m of targets) {
    const used30 = dupNames.has(m.name) ? (curById[m.id] || 0) : (curByName[m.name] || 0);
    const usedPrev30 = dupNames.has(m.name) ? (prevById[m.id] || 0) : (prevByName[m.name] || 0);
    const dispenseDays30 = dupNames.has(m.name) ? (curDaysById[m.id]?.size || 0) : (curDaysByName[m.name]?.size || 0);
    batch.update(db.collection('meds').doc(m.id), { used30: Math.round(used30), usedPrev30: Math.round(usedPrev30), dispenseDays30 });
    opsInBatch++;
    written++;
    if (opsInBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  // ---------------------------------------------------------------------------------------------
  // Part 2: weekday usage pattern (floor-par weekday-peak multiplier) + single-day peak dispense
  // clamp — ported from analyzeWeekdayUsage() (src/store/AppContext.tsx). See that function's own
  // doc comment for the full "why"; kept here only as much comment as explains THIS port, not a
  // re-derivation of the reasoning that already lives there.
  // ---------------------------------------------------------------------------------------------
  const LOOKBACK_DAYS = 91; // ~13 weeks — up to 13 real occurrences of each weekday to average
  const MIN_OCC_PER_WEEKDAY = 4; // below this, a weekday's own average isn't trustworthy yet
  const MEANINGFUL_FACTOR = 1.15; // peak-vs-average ratio below this reads as flat/noise
  const PEAK_LOOKBACK_DAYS = 180; // ~26 weeks — reliably covers at least one quarterly refill cycle
  const cutoff = now - LOOKBACK_DAYS * DAY;
  const peakCutoff = now - PEAK_LOOKBACK_DAYS * DAY;

  // key -> [bucket per weekday 0..6] -> Map<isoDate, summed qty that day>
  const byKeyWeekday = new Map();
  // key -> Map<isoDate, summed qty that day> over the longer PEAK_LOOKBACK_DAYS window, not split
  // by weekday — just "how much went out THIS day" per med.
  const byKeyDay = new Map();
  for (const d of txSnap.docs) {
    const x = d.data();
    // Same type-filter restoration as Part 1 above.
    if (x.type !== 'reconcile_hosxp') continue;
    if (!x.name || typeof x.qty !== 'number' || x.qty >= 0 || typeof x.ts !== 'number') continue; // dispensed only
    if (x.ts > now) continue;
    const key = dupNames.has(x.name) ? (x.medId ? 'id:' + x.medId : null) : 'name:' + x.name;
    if (!key) continue;
    // Real-world explanation: "เช้าวันจันทร์จะตัดยอดหน้างานโดยแนบไฟล์ ของวันศุกร์ เสาร์และอาทิตย์
    // เป็นจำนวน 3 วัน" — a batch's qty can represent SEVERAL real calendar days combined, not just
    // the one `ts` happened to land on (always "today," even for a catch-up). Spread it evenly
    // across every real day in its covered range (coveredFrom/coveredTo — falls back to a single
    // day at x.ts for a tx row from before this field existed), mirroring analyzeWeekdayUsage()
    // (src/store/AppContext.tsx) exactly.
    const fromIso = x.coveredFrom || isoDate(x.ts);
    const toIso = x.coveredTo || isoDate(x.ts);
    const fromTs = new Date(fromIso + 'T00:00:00').getTime();
    const toTs = new Date(toIso + 'T00:00:00').getTime();
    const daysCovered = Math.max(1, Math.round((toTs - fromTs) / DAY) + 1);
    const perDayQty = Math.abs(x.qty) / daysCovered;
    for (let i = 0; i < daysCovered; i++) {
      const dayTs = fromTs + i * DAY;
      if (dayTs > now) continue;
      const wd = bangkokWeekday(dayTs);
      if (wd === 0 || wd === 6) continue; // this hospital never reconciles on a weekend
      const dayKey = isoDate(dayTs);
      if (dayTs >= peakCutoff) {
        let dayMap = byKeyDay.get(key);
        if (!dayMap) { dayMap = new Map(); byKeyDay.set(key, dayMap); }
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + perDayQty);
      }
      if (dayTs < cutoff) continue;
      let buckets = byKeyWeekday.get(key);
      if (!buckets) { buckets = [0, 1, 2, 3, 4, 5, 6].map(() => new Map()); byKeyWeekday.set(key, buckets); }
      buckets[wd].set(dayKey, (buckets[wd].get(dayKey) || 0) + perDayQty);
    }
  }

  let analyzed = 0;
  let patterned = 0;
  let peaksFound = 0;
  const writes = [];
  for (const m of targets) {
    const key = dupNames.has(m.name) ? 'id:' + m.id : 'name:' + m.name;
    let weekday;
    let peak;

    const dayMap = byKeyDay.get(key);
    if (dayMap && dayMap.size > 0) {
      let peakQty = 0, peakDate = '';
      for (const [day, qty] of dayMap) { if (qty > peakQty) { peakQty = qty; peakDate = day; } }
      const roundedPeak = Math.round(peakQty);
      // Real-world report (METFORMIN - PL 500 mg.): see percentile()'s own comment above and
      // Med.peakDayP90Qty's (src/types.ts) — the 90th percentile of this SAME dayMap's values.
      const p90Qty = Math.round(percentile(Array.from(dayMap.values()), 0.9));
      // Mirrors AppContext.tsx's analyzeWeekdayUsage() exactly — see Med.usageCv's own doc
      // comment (src/types.ts). Same dayMap as p90Qty above; needs ≥2 real days to mean anything.
      const cvVal = dayMap.size >= 2 ? Math.round(coefficientOfVariation(Array.from(dayMap.values())) * 1000) / 1000 : undefined;
      if (roundedPeak > 0 && (roundedPeak !== m.peakDayQty || peakDate !== m.peakDayDate || p90Qty !== m.peakDayP90Qty || cvVal !== m.usageCv)) {
        peak = { qty: roundedPeak, date: peakDate, p90: p90Qty, cv: cvVal };
        peaksFound++;
      }
    } else if (m.peakDayQty || m.peakDayP90Qty || m.usageCv != null) {
      // No reconcile_hosxp history at all left within the (longer) peak window — the old
      // peak/variability figures are no longer traceable to any real remaining data; clear them
      // all rather than let stale numbers linger forever with nothing backing them.
      peak = 'clear';
    }

    const buckets = byKeyWeekday.get(key);
    if (buckets) {
      const weekdayAvgs = [];
      for (let wd = 1; wd <= 5; wd++) {
        const days = buckets[wd];
        if (days.size < MIN_OCC_PER_WEEKDAY) { weekdayAvgs.length = 0; break; }
        const sum = Array.from(days.values()).reduce((s, v) => s + v, 0);
        weekdayAvgs.push({ wd, avg: sum / days.size, occ: days.size });
      }
      if (weekdayAvgs.length === 5) { // not enough confirmed history for every weekday otherwise
        analyzed++;
        const overallAvg = weekdayAvgs.reduce((s, w) => s + w.avg, 0) / 5;
        if (overallAvg > 0) {
          const pattern = weekdayAvgs.map((w) => Math.round((w.avg / overallAvg) * 100) / 100);
          const peakDay = weekdayAvgs.reduce((a, b) => (b.avg > a.avg ? b : a));
          const factor = peakDay.avg / overallAvg;
          if (factor >= MEANINGFUL_FACTOR) {
            const minOcc = Math.min(...weekdayAvgs.map((w) => w.occ));
            weekday = { factor: Math.round(factor * 100) / 100, day: peakDay.wd, occ: minOcc, pattern };
            patterned++;
          } else if (m.weekdayPeakFactor || m.weekdayPattern) {
            weekday = 'clear'; // pattern flattened out since the last run
          }
        }
      }
    }

    if (weekday || peak) writes.push({ id: m.id, weekday, peak });
  }

  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    writes.slice(i, i + 400).forEach((w) => {
      const fields = {};
      if (w.weekday === 'clear') {
        fields.weekdayPeakFactor = FieldValue.delete(); fields.weekdayPeakDay = FieldValue.delete();
        fields.weekdayPeakOccurrences = FieldValue.delete(); fields.weekdayPattern = FieldValue.delete();
      } else if (w.weekday) {
        fields.weekdayPeakFactor = w.weekday.factor; fields.weekdayPeakDay = w.weekday.day;
        fields.weekdayPeakOccurrences = w.weekday.occ; fields.weekdayPattern = w.weekday.pattern;
      }
      if (w.peak === 'clear') {
        fields.peakDayQty = FieldValue.delete(); fields.peakDayDate = FieldValue.delete(); fields.peakDayP90Qty = FieldValue.delete(); fields.usageCv = FieldValue.delete();
      } else if (w.peak) {
        fields.peakDayQty = w.peak.qty; fields.peakDayDate = w.peak.date; fields.peakDayP90Qty = w.peak.p90;
        if (w.peak.cv !== undefined) fields.usageCv = w.peak.cv;
      }
      b.update(db.collection('meds').doc(w.id), fields);
    });
    await b.commit();
  }

  // ---------------------------------------------------------------------------------------------
  // Part 3: real-world ground-truth feedback — recentStockoutDays30 (Med) + effectiveLeadTimeDays
  // (meta/settings). See both fields' own doc comments (src/types.ts) for the full "why": every
  // signal above is still a FORECAST; this is the opposite — what actually happened. Deliberately
  // NOT ported into the client's analyzeWeekdayUsage() — `dailyMetrics` itself only ever updates
  // once a day (collect-daily-metrics.mjs), so recomputing this more often than once a day (this
  // script's own schedule) would just re-read the same rows for no new information. One bounded
  // 30-day query — same window ReportScreen's stability tab already fetches for its own
  // recurringStockouts()/leadTimeTrend() insight cards (src/store/selectors.ts) — feeds both
  // outputs.
  // ---------------------------------------------------------------------------------------------
  const STOCKOUT_WINDOW_DAYS = 30;
  const STOCKOUT_FEEDBACK_MIN_DAYS = 3; // mirrors suggestPar()'s own threshold (selectors.ts)
  const dailyMetricsSnap = await db.collection('dailyMetrics')
    .where('date', '>=', isoDate(now - STOCKOUT_WINDOW_DAYS * DAY))
    .get();
  const stockoutDayCounts = {};
  let leadTimeHoursTotal = 0;
  let leadTimeApprovedTotal = 0;
  dailyMetricsSnap.docs.forEach((d) => {
    const row = d.data();
    for (const medId of row.stockoutMedIds || []) stockoutDayCounts[medId] = (stockoutDayCounts[medId] || 0) + 1;
    const approved = row.receiveApprovedCount || 0;
    if (approved > 0 && typeof row.receiveLeadTimeAvgHours === 'number') {
      leadTimeHoursTotal += row.receiveLeadTimeAvgHours * approved;
      leadTimeApprovedTotal += approved;
    }
  });

  let stockoutWrites = 0;
  for (let i = 0; i < targets.length; i += 400) {
    const b = db.batch();
    let any = false;
    targets.slice(i, i + 400).forEach((m) => {
      const dayCount = stockoutDayCounts[m.id] || 0;
      const nextVal = dayCount >= STOCKOUT_FEEDBACK_MIN_DAYS ? dayCount : undefined;
      if (nextVal === m.recentStockoutDays30) return; // unchanged — skip the write
      b.update(db.collection('meds').doc(m.id), { recentStockoutDays30: nextVal === undefined ? FieldValue.delete() : nextVal });
      any = true;
      stockoutWrites++;
    });
    if (any) await b.commit();
  }

  // ceil (not round) — a real lead time of e.g. 4.2 days must never round DOWN to a subCoverDays
  // floor that's shorter than what was actually observed.
  const effectiveLeadTimeDays = leadTimeApprovedTotal > 0 ? Math.ceil(leadTimeHoursTotal / leadTimeApprovedTotal / 24) : null;

  // Same shared meta/settings doc expiryWarnDays/parFloorCoverDays/parSubCoverDays already live
  // in (see AppContext.tsx) — SettingsScreen reads this to warn when the numbers behind every par
  // suggestion are stale. Now covers BOTH halves of this script (used30/usedPrev30 AND the
  // weekday/peak analysis run right after it in the same job), so the one existing staleness
  // indicator in SettingsScreen stays accurate for both without needing a second field.
  await db.collection('meta').doc('settings').set(
    { usageStatsRecomputedAt: now, ...(effectiveLeadTimeDays !== null ? { effectiveLeadTimeDays } : { effectiveLeadTimeDays: FieldValue.delete() }) },
    { merge: true },
  );

  // txSnap.size now counts every tx TYPE in the query's date window (see its own fetch comment
  // above) — no longer a meaningful "how much reconcile_hosxp history did this use" number on
  // its own, so count just the reconcile_hosxp rows for this log line instead.
  const reconcileRowCount = txSnap.docs.reduce((n, d) => n + (d.data().type === 'reconcile_hosxp' ? 1 : 0), 0);
  console.log(`✓ Recomputed used30/usedPrev30 for ${written} active med(s) from ${reconcileRowCount} reconcile_hosxp tx row(s).`);
  console.log(`✓ Weekday-pattern/peak-day analysis: ${analyzed} med(s) had enough history to analyze, ${patterned} with a meaningful weekday pattern, ${peaksFound} with a new single-day peak.`);
  console.log(`✓ Ground-truth feedback: ${stockoutWrites} med(s) had a recentStockoutDays30 change from ${dailyMetricsSnap.size} dailyMetrics row(s); effectiveLeadTimeDays = ${effectiveLeadTimeDays ?? '(no sample)'}.`);
}

main().catch((err) => {
  console.error('Usage stats recompute FAILED:', err);
  process.exit(1);
});
