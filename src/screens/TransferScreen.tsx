import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { toneFor, subTone, usesSubstock, floorMinOf, isUrgentLow, categoryOf, effectiveRouteOf, binDisplayAll, daysOfStockLeft, expTone, isOnStockHold, boxBreakdownLabel } from '../store/selectors';
import { nf, thDate, digitsOnly, isoDate, daysUntil, bangkokWeekday } from '../utils/format';
import { medColor } from '../utils/color';
import { MedDot } from '../components/MedDot';
import { Qty, DeficitBadge, DaysLeftBadge, PackSizeBadge, UsageRateBadge, PAR_LABEL_COLOR } from '../components/Qty';
import { HadTag } from '../components/Badge';
import { MedMiniCard } from '../components/MedMiniCard';
import { EmptyState } from '../components/EmptyState';
import { StepIndicator, TRANSFER_STEPS } from '../components/StepIndicator';
import { SearchInput } from '../components/SearchInput';
import { DRUG_CATEGORIES } from '../data/categories';
import { WEEKDAY_CLINICS } from '../data/clinics';
import StockHoldBanner from '../components/StockHoldBanner';

// Bug fix (flow friction): these two banners used to be plain useState(true) — the intent (per
// the comments at their call sites below) was "a fresh nudge each time this SCREEN is opened",
// meaning roughly once a day on a shared device. But the real เติมหน้างาน loop (build cart →
// confirm → commit → "ทำรายการต่อ" → back to this screen) unmounts and remounts this exact
// component several times in a single shift for someone doing several small refill batches
// back to back — each remount reset the ✕'d-away banner right back to visible, costing a real
// extra tap every single time for information already acknowledged minutes earlier. Keying the
// dismissal by today's calendar date in sessionStorage (cleared on browser/tab close, same as
// the daily-reset-on-shared-device behavior the original comment wanted) makes "opened" mean
// what it was supposed to mean — once per day — without reaching for global AppContext state
// for something this screen-local and disposable.
function readDismissedToday(key: string): boolean {
  try { return sessionStorage.getItem(key) === isoDate(Date.now()); } catch { return false; }
}
function dismissToday(key: string) {
  try { sessionStorage.setItem(key, isoDate(Date.now())); } catch { /* ignore */ }
}

// Real-world request: "กด + แล้วยังขึ้นเป็นจำนวนเม็ด ไม่ใช่จำนวนกล่องที่เราคุยกันไว้" — the cart
// qty field (between the −/+ buttons) always showed the raw tablet total, even for a box-only
// med whose whole point was to think in boxes. Shows the compact "NxSIZE[+remainder]" form
// (boxBreakdownLabel, compact mode — no spaces/unit word, fits this narrow field) while the field
// ISN'T focused, so every tap of +/- immediately reads back as boxes; switches to the plain raw
// number the moment someone taps in to type a value by hand (that compact string isn't itself
// parseable back into a number), and back to the box label on blur. A non-boxed med (no
// packSize) just shows the plain number always — nothing to translate into boxes for.
function CartQtyInput({ med, value, onChange }: { med: { packSize?: number; unit: string; name: string }; value: number; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const boxed = !!med.packSize && med.packSize > 1;
  const label = boxed && !focused ? boxBreakdownLabel(med, value, true) : undefined;
  return (
    <input
      value={label ?? (value || '')}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(digitsOnly(e.target.value))}
      inputMode="numeric"
      aria-label={'จำนวน ' + med.name}
      // Bug fix (mobile fit): under 16px, iOS Safari zooms the whole page in on focus — this is
      // the highest-traffic numeric field on the busiest screen in the app (walking the shelf,
      // bumping cart quantities item by item).
      style={{ width: boxed ? 80 : 62, height: 44, textAlign: 'center', border: '1px solid var(--border)', borderRadius: 10, fontSize: boxed ? 14 : 16, fontWeight: 600 }}
    />
  );
}

export default function TransferScreen() {
  const { state, sub, fefo, fefoFloor, setSearch, setFilter, bump, setCartQty, fillAll, fillUrgent, clearCart, printPickList, printTodayReplenishList, go, openScanSearch, goSubstockCardFor } = useApp();
  // Real-world request: "ให้ทุกหน้าที่แสดงชื่อยาจำนวนยา...ให้สามารถดูบัตรสต็อคได้" — this screen
  // already had an indirect path (tap "ดูภาพรวม" to expand MedMiniCard, which has its own "ดู
  // บัตรสต็อกเต็ม →" link at the bottom), but that's an extra tap before the extra tap. Making
  // the whole row itself open the card directly — same rowToCard/stopRowNav pattern
  // HomeScreen's own rows use (see its "Bug fix (flow clarity)" comment) — gets there in one
  // tap instead of two. stopRowNav keeps the −/qty input/+ buttons and "ดูภาพรวม" toggle working
  // exactly as before (a tap on any of THEM must not also navigate away).
  const rowToCard = (medId: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => goSubstockCardFor(medId),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goSubstockCardFor(medId); } },
    title: 'ดูบัตรสต็อกยานี้',
  });
  const stopRowNav = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  // Only one row's "เคลื่อนไหวล่าสุด" panel expanded at a time (opt-in, not automatic) — the
  // list can render up to 60 rows, and MedMiniCard fetches a real Firestore query per drug, so
  // expanding all of them at once would fire dozens of queries for a screen someone's trying
  // to move through quickly. One at a time keeps it fast and never surprises with a slow
  // screen after a search or filter change.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // หมวดกลุ่มยา — ตัวกรองแยกต่างหากจากตัวกรอง low/all/had ด้านบน (คนละมิติกัน ใช้ร่วมกันได้):
  // กลุ่มที่จ่ายออกทุกวัน (ยาแก้ปวด/ปฏิชีวนะ) ไล่ดูรวดเดียวได้ ส่วนกลุ่มที่ใช้นาน ๆ ครั้ง (ยาฉุกเฉิน)
  // ก็กรองดูเฉพาะกลุ่มนั้นได้โดยไม่ต้องไล่สายตาผ่านรายการทั้งหมดทุกเช้า. Local view state, not
  // global AppContext state — same pattern as MedsScreen's wardTab, a pure display filter with
  // nothing else in the app needing to read it.
  const [catTab, setCatTab] = useState<'all' | string>('all');
  // How the list is ordered. 'need' (default) keeps the original behavior — emptiest shelves
  // relative to their own Max first, so the most urgent refills are always on top. 'bin' walks
  // the list in shelf-code order instead, which is what someone actually pushing a cart down
  // the aisle wants: one pass past each shelf rather than criss-crossing the room in urgency
  // order. 'name' is for when someone is looking up a specific drug in a familiar list.
  const [sort, setSort] = useState<'need' | 'bin' | 'name'>('need');
  // Collapsible, dismissed for the rest of TODAY (see readDismissedToday's doc comment above) —
  // a fresh "should I check today's clinics" nudge once a day, not once per screen visit.
  const [showClinicInfo, setShowClinicInfo] = useState(() => !readDismissedToday('opd-clinic-banner-dismissed'));
  const todayClinics = WEEKDAY_CLINICS[new Date().getDay()];
  // Friday-only nudge, separate from the clinic-info banner above (this one is actionable, not
  // just FYI) — the shelf isn't topped up again until Monday, so whatever's left after Friday's
  // fill has to survive a real 3-day gap (Fri+Sat+Sun). Filling only up to Min on Friday (the
  // everyday habit the rest of the week) leaves a shelf just barely above its weekday reorder
  // point to somehow last three days with nobody there to top it up if it runs low — filling all
  // the way to Max specifically on Friday is what actually closes that gap.
  const [showFridayNudge, setShowFridayNudge] = useState(() => !readDismissedToday('opd-friday-nudge-dismissed'));
  const isFriday = new Date().getDay() === 5;
  // Follow-up to the weekday-usage-pattern analysis (analyzeWeekdayUsage, AppContext.tsx) —
  // ผู้ใช้ถามว่า "มีอะไรตกหล่นบ้าง" หลัง merge รอบแรก แล้วขอให้ทำทั้งหมด: the detected pattern
  // previously only ever showed up in the Admin-only SettingsScreen insight card — invisible to
  // whoever is actually walking the floor doing today's real เติมหน้างาน. bangkokWeekday() (not
  // the device-local new Date().getDay() isFriday above uses) so this agrees with how
  // analyzeWeekdayUsage() itself computed weekdayPeakDay in the first place.
  const todayWeekday = bangkokWeekday(Date.now());
  // noSubstock meds (liquids/sprays — received straight to the shelf, see ReceiveScreen)
  // have nothing to transfer from; showing them here with permanently-stuck-at-0 +/- buttons
  // would just be confusing clutter, not a real "เติมหน้างาน" candidate.
  // Bug fix (user-reported): a med flagged isOnStockHold() ("ยาขาดชั่วคราว" — see MedsScreen)
  // still showed up in this whole screen's ต่ำกว่า Min/เร่งด่วนวันนี้/ทั้งหมด lists, inviting
  // someone to try filling a shelf from supply that's known to be unavailable. StockHoldBanner
  // already surfaces it elsewhere (with the reason, and a resolve action for Admin) — it has no
  // business cluttering the day-to-day เติมหน้างาน working list while still on hold.
  // OPD/IPD ward tabs removed — one combined list (wardFilter stays 'all').
  const meds = state.meds.filter((m) => m.active && usesSubstock(m) && !isOnStockHold(m));
  const low = meds.filter((m) => m.floor < floorMinOf(m));
  // Subset of `low` already at/below half of Min — see isUrgentLow()'s doc comment
  // (selectors.ts) for why this exists: a short-staffed day needs a way to do just the
  // can't-wait items without either doing everything below Min or guessing which ones matter.
  const urgent = meds.filter(isUrgentLow);
  const q = state.search.trim().toLowerCase();
  const filteredByStatus = meds.filter((m) => {
    if (q && m.name.toLowerCase().indexOf(q) < 0 && m.code.toLowerCase().indexOf(q) < 0) return false;
    if (state.filter === 'low') return m.floor < floorMinOf(m);
    if (state.filter === 'urgent') return isUrgentLow(m);
    if (state.filter === 'had') return m.had;
    if (state.filter === 'fridge') return m.fridge;
    return true;
  });
  // Counts per category under the low/all/had + search filter above but BEFORE the category
  // tab itself narrows anything — same reasoning as MedsScreen's catCounts: seeing "ยาแก้ปวด…
  // (18)" next to "ยาฉุกเฉิน… (2)" is what makes a high-volume vs. low-volume group visible at
  // a glance, before even tapping a chip.
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredByStatus.forEach((m) => { const c = categoryOf(m); counts[c] = (counts[c] || 0) + 1; });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meds, state.filter, q]);
  const filtered = filteredByStatus
    .filter((m) => catTab === 'all' || categoryOf(m) === catTab)
    // Bug fix: a brand-new med with parFloor still 0 (Max not set yet) made this divide by
    // zero — 0/0 is NaN, and a sort comparator that ever returns NaN breaks the sort's
    // ordering guarantee for the WHOLE list, not just that one row (V8 doesn't handle NaN
    // comparisons predictably). Math.max(1, ...) matches the same guard toneFor() already
    // uses for this exact ratio elsewhere.
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'th');
      if (sort === 'bin') {
        // Blank shelf codes sort last rather than first — an unassigned bin is not "shelf A",
        // it's "nobody has told the app where this lives yet", and floating those to the top
        // of a walking route would be actively wrong.
        const ab = binDisplayAll(a);
        const bb = binDisplayAll(b);
        if (!ab !== !bb) return ab ? -1 : 1;
        return ab.localeCompare(bb, 'en') || a.name.localeCompare(b.name, 'th');
      }
      return a.floor / Math.max(1, a.parFloor) - b.floor / Math.max(1, b.parFloor);
    });

  // Real-world request: "แยกยากินกับยาฉีด...เพื่อง่ายต่อการเบิกยาจริงหน้างาน เพื่อไม่ให้ความสับสน" —
  // walking between the oral shelf and the locked injectable cabinet back and forth while
  // picking is exactly the confusion this exists to remove. Route always wins over `sort` as
  // the PRIMARY grouping (nobody picking a cart wants ยากิน/ยาฉีด interleaved no matter which
  // sort is active) — `sort` still orders rows WITHIN each route group exactly as before.
  // Array.prototype.filter preserves relative order, so three filters over the already-sorted
  // `filtered` is enough to stable-partition it without re-sorting anything. Capped at the same
  // 60-row total `filtered.slice(0, 60)` used before this — sliced once as one combined list so
  // a short "ยาฉีด" group never gets silently dropped just because enough "ยากิน" rows filled the
  // whole cap first. Uses effectiveRouteOf() (not the plain routeOf()) specifically so this
  // actually groups the FIRST time it's seen, for the entire existing formulary that has no
  // explicit `route` set yet — see effectiveRouteOf()'s own doc comment in selectors.ts for why
  // requiring a manual per-med chip or an admin bulk-action click first was real friction users
  // hit immediately ("ให้มานั่งปรับทีละตัวยาก").
  const visibleRows = [
    ...filtered.filter((m) => effectiveRouteOf(m) === 'oral'),
    ...filtered.filter((m) => effectiveRouteOf(m) === 'injection'),
    ...filtered.filter((m) => effectiveRouteOf(m) === 'other'),
  ].slice(0, 60);
  const routeGroups: { key: 'oral' | 'injection' | 'other'; label: string }[] = [
    { key: 'oral', label: '💊 ยากิน' },
    { key: 'injection', label: '💉 ยาฉีด' },
    { key: 'other', label: '📦 อื่นๆ / ยังไม่ระบุประเภท' },
  ];
  // A header for every non-empty group only when there's more than one to tell apart — a
  // filtered view that happens to contain just one route (e.g. ตู้เย็น often being all ยาฉีด)
  // shouldn't show a single redundant "💉 ยาฉีด" header above literally everything on screen.
  const nonEmptyRouteGroupCount = routeGroups.filter((g) => visibleRows.some((m) => effectiveRouteOf(m) === g.key)).length;

  const cartIds = Object.keys(state.cart);
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? 'var(--ink-soft)' : 'var(--ink)' });

  return (
    <div style={{ animation: 'fade .18s' }}>
      <StepIndicator steps={TRANSFER_STEPS} current={0} />
      <StockHoldBanner />
      {/* เตือนเฉยๆ ไม่กรอง/ไม่ซ่อนอะไร — คลินิกวันนี้อาจทำให้ยากลุ่มนี้ใช้เร็วกว่าปกติ เผื่อดูก่อน
          รายการอื่นที่เหลือ ("ตรวจทั่วไป" ใช้ยาแทบทุกหมวดอยู่แล้วทุกวัน ไม่ต้องระบุแยก) */}
      {todayClinics && showClinicInfo && (
        <div style={{ margin: '10px 14px 0', padding: '9px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
          <span style={{ flex: 'none', fontSize: 14 }}>📅</span>
          <span className="muted" style={{ flex: 1, lineHeight: 1.4 }}>คลินิกวันนี้ — {todayClinics} · ยากลุ่มนี้อาจใช้เร็วกว่าปกติ</span>
          <button onClick={() => { dismissToday('opd-clinic-banner-dismissed'); setShowClinicInfo(false); }} aria-label="ปิดข้อความนี้" style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--muted)', fontSize: 15, padding: '2px 4px', lineHeight: 1 }}>✕</button>
        </div>
      )}
      {/* Actionable (not just FYI) — เฉพาะวันศุกร์: เสาร์-อาทิตย์ไม่มีเติมหน้างาน ของที่เติมวันนี้
          ต้องอยู่ได้ถึงเช้าวันจันทร์ เติมแค่ถึง Min แบบวันธรรมดาทั่วไปไม่พอ */}
      {isFriday && showFridayNudge && (
        <div style={{ margin: '10px 14px 0', padding: '9px 12px', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
          <span style={{ flex: 'none', fontSize: 14 }}>⚠️</span>
          <span style={{ flex: 1, lineHeight: 1.4, color: 'var(--amber-ink)' }}>วันนี้ศุกร์ — เสาร์-อาทิตย์ไม่มีเติมหน้างาน แนะนำเติมให้เต็ม Max แทนแค่ถึง Min เผื่อของอยู่ได้ถึงวันจันทร์</span>
          <button onClick={() => { dismissToday('opd-friday-nudge-dismissed'); setShowFridayNudge(false); }} aria-label="ปิดข้อความนี้" style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--amber-ink)', fontSize: 15, padding: '2px 4px', lineHeight: 1 }}>✕</button>
        </div>
      )}
      <div style={{ padding: '12px 14px 10px' }} className="sticky-bar">
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchInput
            value={state.search}
            onChange={setSearch}
            placeholder="ค้นหาชื่อยา / สแกน QR"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button onClick={() => openScanSearch('transfer')} title="สแกน QR เติมหน้างาน" aria-label="สแกน QR เติมหน้างาน" style={{ border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', borderRadius: 10, width: 46, minHeight: 44, fontSize: 17, flex: 'none' }}>▣</button>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 9, overflowX: 'auto', paddingBottom: 2 }}>
          {/* "เร่งด่วนวันนี้" — ต่ำกว่าครึ่งหนึ่งของ Min เท่านั้น (isUrgentLow) — วันที่กำลังคนน้อย
              กดดูแค่กลุ่มนี้ก่อนได้ ไม่ต้องเติมทุกอย่างที่ต่ำกว่า Min ในครั้งเดียว */}
          <button className="chip" style={{ ...chip(state.filter === 'urgent'), ...(state.filter === 'urgent' ? { background: 'var(--red)', borderColor: 'var(--red)' } : { color: urgent.length ? 'var(--red)' : undefined, borderColor: urgent.length ? 'var(--red)' : undefined }) }} onClick={() => setFilter('urgent')}>🔴 เร่งด่วนวันนี้ ({urgent.length})</button>
          <button className="chip" style={chip(state.filter === 'low')} onClick={() => setFilter('low')}>ต่ำกว่า Min ({low.length})</button>
          <button className="chip" style={chip(state.filter === 'all')} onClick={() => setFilter('all')}>ทั้งหมด</button>
          <button className="chip" style={chip(state.filter === 'had')} onClick={() => setFilter('had')}>High alert</button>
          <button className="chip" style={{ ...chip(state.filter === 'fridge'), ...(state.filter === 'fridge' ? { background: 'var(--fridge)', borderColor: 'var(--fridge)' } : {}) }} onClick={() => setFilter('fridge')}>🧊 ตู้เย็น</button>
          {urgent.length > 0 && (
            <button className="chip" style={{ border: '1px dashed var(--red)', background: 'transparent', color: 'var(--red)' }} onClick={fillUrgent} title="เติมเฉพาะรายการที่ต่ำกว่าครึ่งหนึ่งของ Min — ที่เหลือรอได้ ไม่ต้องเติมทีละเยอะๆ">เติมเฉพาะเร่งด่วนวันนี้</button>
          )}
          <button className="chip" style={{ border: '1px dashed var(--green)', background: 'transparent', color: 'var(--green)' }} onClick={fillAll}>เติมตาม par ทั้งหมด</button>
          <button
            className="chip"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={printTodayReplenishList}
            title="พิมพ์รายการที่ต้องเติมวันนี้ให้ถึง par — ไม่กระทบตะกร้า"
          >
            🖨 พิมพ์ใบเติมหน้างานวันนี้{low.length > 0 ? ' (' + low.length + ')' : ''}
          </button>
        </div>
        {/* หมวดกลุ่มยา — คนละมิติกับตัวกรอง low/all/had ด้านบน ใช้ร่วมกันได้ ให้เลือกดูเฉพาะกลุ่มที่
            จ่ายออกเยอะทุกวันแยกจากกลุ่มที่ใช้นาน ๆ ครั้งได้ ไม่ต้องไล่สายตาผ่านทั้งฟอร์มมิวลารี */}
        <div style={{ display: 'flex', gap: 7, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
          <button className="chip" style={chip(catTab === 'all')} onClick={() => setCatTab('all')}>ทุกหมวด</button>
          {DRUG_CATEGORIES.map((c) => catCounts[c.id] ? (
            <button key={c.id} className="chip" style={chip(catTab === c.id)} onClick={() => setCatTab(c.id)}>{c.label} ({catCounts[c.id]})</button>
          ) : null)}
        </div>
        {/* ลำดับการแสดง — "ตามชั้นวาง" คือลำดับสำหรับเดินหยิบของจริงรอบเดียวจบ ไม่ต้องเดินย้อนไปมา */}
        <div style={{ display: 'flex', gap: 7, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
          <span className="muted" style={{ fontSize: 11, flex: 'none', alignSelf: 'center', paddingRight: 2 }}>เรียง:</span>
          <button className="chip" style={chip(sort === 'need')} onClick={() => setSort('need')}>ขาดมากสุดก่อน</button>
          <button className="chip" style={chip(sort === 'bin')} onClick={() => setSort('bin')}>ตามชั้นวาง</button>
          <button className="chip" style={chip(sort === 'name')} onClick={() => setSort('name')}>ตามชื่อยา</button>
        </div>
      </div>

      <div style={{ padding: '10px 14px 96px' }}>
        {routeGroups.map((group) => {
          const groupRows = visibleRows.filter((m) => effectiveRouteOf(m) === group.key);
          if (!groupRows.length) return null;
          return (
            <div key={group.key}>
              {nonEmptyRouteGroupCount > 1 && (
                <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, margin: '4px 2px 7px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {group.label} ({groupRows.length})
                </div>
              )}
              {groupRows.map((m, i) => {
                const f = fefo(m.id);
                const ff = fefoFloor(m.id);
                const inCart = !!state.cart[m.id];
                return (
                  <div
                    key={m.id}
                    className="card row-interactive"
                    {...rowToCard(m.id)}
                    style={{
                      padding: '11px 12px 11px 14px', marginBottom: 8, borderColor: inCart ? 'var(--green)' : 'var(--border)',
                      borderLeft: '4px solid ' + medColor(m.code), animation: 'pop .22s var(--ease-out) both', animationDelay: Math.min(i, 10) * 18 + 'ms', cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                          <MedDot code={m.code} />
                          {/* Real-world request: "รายการที่ต้องเติมหน้างานอยากให้มีชั้นวางโชว์ด้วยครับ
                              เพื่อหาตำแหน่งของยาได้อย่างถูกต้อง" — this list already sorts by shelf
                              position ("ตามชั้นวาง", see binDisplayAll's own sort use below) but never
                              actually PRINTED the bin code on the row itself, leaving someone walking
                              the shelf with no way to confirm they're at the right spot without
                              opening the med individually. Same badge style CountScreen's own
                              shelf-order rows already use. */}
                          {/* Real-world request: "ตรวจสอบการเบิกใช้ยา...เห็นง่ายว่า...เอายาที่ไหน" — the
                              badge above only ever said where the stock is HEADED (the floor shelf);
                              nothing on this row said where to actually go PICK it from in substock,
                              even though the printed ใบเติมหน้างานประจำวัน sheet already got this exact
                              "หยิบจาก (substock)" column. A different color (purple, unused elsewhere
                              on this row) from the floor-bin badge so the two can never be misread for
                              each other — purple = where to start, green = where it ends up. Hidden
                              for a noSubstock med (nothing to pick — see commitReceive) or one with no
                              substock shelf code assigned yet. */}
                          {!m.noSubstock && m.binSub && <span title="หยิบจาก substock" style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--ipd)', background: 'var(--ipd-bg)', borderRadius: 6, padding: '1px 6px' }}>หยิบ {m.binSub}</span>}
                          {binDisplayAll(m) && <span title="เติมที่ชั้นวางหน้างาน" style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--green)', background: 'var(--green-tint)', borderRadius: 6, padding: '1px 6px' }}>{binDisplayAll(m)}</span>}
                          <span>{m.name}</span>
                          {m.had && <HadTag />}
                          {m.fridge && <span title="ยาตู้เย็น — ต้องแช่เย็น" style={{ color: 'var(--fridge)', fontSize: 12 }}>🧊</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                          หน้างาน <Qty value={m.floor} unit={m.unit} tone={toneFor(m)} size={12.5} /> ·{' '}
                          <span style={{ color: PAR_LABEL_COLOR.min, fontWeight: 700 }}>Min {nf(floorMinOf(m))}</span> /{' '}
                          <span style={{ color: PAR_LABEL_COLOR.max, fontWeight: 700 }}>Max {nf(m.parFloor)}</span> · substock{' '}
                          <Qty value={sub(m.id)} tone={subTone(sub(m.id), m.parSub)} size={12.5} /> /{' '}
                          <span style={{ color: PAR_LABEL_COLOR.sub, fontWeight: 700 }}>par {nf(m.parSub)}</span> {m.unit}
                        </div>
                        {/* Same at-a-glance floor-vs-par bar HomeScreen's low-stock list already uses
                            — brought here too so the screen someone actually works from all day shows
                            the same clear picture, not just a line of numbers to parse. */}
                        <div className="bar-track" style={{ height: 4, background: 'var(--border-soft)', borderRadius: 2, marginTop: 5 }}>
                          <div className="bar-fill" style={{ height: '100%', transform: 'scaleX(' + Math.max(3, Math.min(100, Math.round((m.floor / Math.max(1, m.parFloor)) * 100))) / 100 + ')', background: toneFor(m), borderRadius: 2 }} />
                        </div>
                        {/* Bug fix (patient safety): this line always rendered flat green — FEFO's
                            own sort-by-soonest-expiry was already correct, but "sorts by expiry" and
                            "warns you when the soonest-expiring lot is itself already expired or
                            about to be" are two different things, and only the first existed.
                            Nothing here ever purges/blocks an expired lot (that's scrapLot's own
                            manual job) — a FEFO transfer will still draw from it, so this is the one
                            moment before that write actually happens to flag it. expTone() already
                            existed in selectors.ts for exactly this color scale but had no call site
                            anywhere in the app until now. */}
                        {(() => {
                          const fefoDays = f ? daysUntil(f.exp) : null;
                          const tone = fefoDays !== null ? expTone(fefoDays, state.expiryWarnDays) : 'var(--green)';
                          return (
                            <div style={{ fontSize: 11.5, color: tone, marginTop: 5, fontWeight: fefoDays !== null && fefoDays < 30 ? 700 : undefined }}>
                              FEFO: lot {f ? f.lotNo : '—'} · exp {f ? thDate(f.exp) : 'ไม่มีของใน substock'}
                              {f && <span className="muted" style={{ color: 'inherit', opacity: fefoDays !== null && fefoDays < 30 ? 1 : undefined }}> (เหลือ {nf(f.qty)})</span>}
                              {fefoDays !== null && fefoDays < 0 && <span> — ⚠ หมดอายุแล้ว ควรตัดออกก่อนเติม</span>}
                              {fefoDays !== null && fefoDays >= 0 && fefoDays < 30 && <span> — ⚠ ใกล้หมดอายุมาก</span>}
                            </div>
                          );
                        })()}
                        {/* Floor-lot tracking follow-up (see FloorLot in types.ts): once stock
                            moves to the floor it previously had zero lot/expiry detail at all —
                            this is the one place that matters most, since it's where the drug is
                            actually about to be handed to a patient. Best-effort by nature (floor
                            batches are tracked from transfers in and deducted via a FEFO guess on
                            daily HOSxP dispensing, which has no real batch detail of its own), so
                            this stays a secondary warning alongside the substock FEFO line above,
                            never a replacement for it — hidden entirely when there's no floor-lot
                            data yet for this med (nothing transferred under this feature, or it's
                            all been dispensed/scrapped). */}
                        {ff && (() => {
                          const ffDays = daysUntil(ff.exp);
                          const tone = expTone(ffDays, state.expiryWarnDays);
                          return (
                            <div style={{ fontSize: 11.5, color: tone, marginTop: 3, fontWeight: ffDays < 30 ? 700 : undefined }}>
                              บนชั้น: lot {ff.lotNo} · exp {thDate(ff.exp)}
                              <span className="muted" style={{ color: 'inherit', opacity: ffDays < 30 ? 1 : undefined }}> (เหลือ {nf(ff.qty)})</span>
                              {ffDays < 0 && <span> — ⚠ หมดอายุแล้วบนชั้น</span>}
                              {ffDays >= 0 && ffDays < 30 && <span> — ⚠ ใกล้หมดอายุมาก</span>}
                            </div>
                          );
                        })()}
                        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {/* Real-world request: "อยากให้ที่หัวมุมรายการยาทุกตัวให้มีข้อมูลว่ายาตัวนี้
                              1 วันใช้ยาจำนวนยาเท่าไร" — lives in this wrapping badge row, not the
                              title line above. Bug fix (real-device report, mobile overlap): the
                              title line has no flexWrap and a long drug name already fills it —
                              a badge pushed there via marginLeft:auto had nowhere to go but
                              overflow sideways, visually landing on top of the qty stepper next
                              to it. Every badge row on this screen already wraps safely; this one
                              now does too. */}
                          <UsageRateBadge m={m} />
                          {/* Shown unconditionally (not tied to today's deficit, unlike DeficitBadge's
                              own box breakdown below) — see PackSizeBadge's own doc comment. */}
                          <PackSizeBadge packSize={m.packSize} unit={m.unit} />
                          <DeficitBadge amount={Math.max(0, m.parFloor - m.floor)} unit={m.unit} urgent={isUrgentLow(m)} packSize={m.packSize} />
                          <DaysLeftBadge days={daysOfStockLeft(state, m)} />
                          {/* Follow-up request: "มีอะไรตกหล่นบ้าง...ทำทั้งหมด" — surfaces the
                              weekday-usage-pattern analysis (analyzeWeekdayUsage, AppContext.tsx)
                              right where someone's actually deciding how much to fill TODAY,
                              not just in the Admin-only SettingsScreen insight card. */}
                          {m.weekdayPeakDay === todayWeekday && (
                            <span title="ยานี้มักใช้มากกว่าปกติในวันนี้ของสัปดาห์ จากสถิติ HOSxP ย้อนหลัง — ลองเผื่อเติมมากกว่าปกติ" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--ipd)', background: 'var(--ipd-bg)', borderRadius: 20, padding: '2.5px 8px' }}>
                              📅 มักใช้มากวันนี้
                            </span>
                          )}
                          <button
                            onClick={stopRowNav(() => setExpandedId(expandedId === m.id ? null : m.id))}
                            style={{ border: 0, background: 'transparent', color: 'var(--muted)', fontSize: 11, fontWeight: 600, padding: '2px 0' }}
                          >
                            {expandedId === m.id ? 'ซ่อนภาพรวม ▲' : 'ดูภาพรวม ▾'}
                          </button>
                        </div>
                        {expandedId === m.id && <MedMiniCard medId={m.id} unit={m.unit} />}
                      </div>
                      {/* stopPropagation here (not per-button) since it also covers the plain qty
                          <input> in between, which has no click handler of its own to wrap — a tap to
                          focus it and type a quantity must never also fire the row's own onClick. */}
                      <div onClick={(e) => e.stopPropagation()} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Bug fix (accessibility): these two were 40px, under the 44px minimum touch
                            target — tapped repeatedly per line item while building a transfer, unlike
                            every other actionable button on this screen (scan/clear/print/submit),
                            which already used 44px+. */}
                        <button onClick={() => bump(m.id, -1)} aria-label={'ลดจำนวน ' + m.name} className="press-spring" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', width: 44, height: 44, borderRadius: 10, fontSize: 19, lineHeight: 1 }}>−</button>
                        <CartQtyInput med={m} value={state.cart[m.id] || 0} onChange={(v) => setCartQty(m.id, v)} />
                        <button onClick={() => bump(m.id, 1)} aria-label={'เพิ่มจำนวน ' + m.name} className="press-spring" style={{ border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', width: 44, height: 44, borderRadius: 10, fontSize: 19, lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {visibleRows.length === 0 && <EmptyState icon="💊" title="ไม่พบรายการยาที่ค้นหา" sub="ลองพิมพ์ชื่อยาแบบสั้นลง หรือเปลี่ยนตัวกรองด้านบน" />}
      </div>

      {cartIds.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 66, padding: '10px 14px', background: 'linear-gradient(to top, var(--bg-app) 60%, rgba(247,246,242,0))', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="muted" style={{ fontSize: 12.5, flex: 1, lineHeight: 1.35 }}>
            {cartIds.length} รายการ · {nf(cartIds.reduce((s, id) => s + state.cart[id], 0))} หน่วย
            {cartIds.some((id) => meds.find((m) => m.id === id)?.had) && (
              <span style={{ display: 'block', color: 'var(--had)', fontWeight: 600 }}>มียา high alert — ต้องสแกน QR ยืนยัน</span>
            )}
          </div>
          <button onClick={clearCart} title="ล้างตะกร้าทั้งหมด" aria-label="ล้างตะกร้าทั้งหมด" style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--muted)', width: 50, height: 50, borderRadius: 12, fontSize: 18 }}>🗑</button>
          <button onClick={printPickList} title="พิมพ์ใบจัดยาเติมชั้น" aria-label="พิมพ์ใบจัดยาเติมชั้น" style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', width: 50, height: 50, borderRadius: 12, fontSize: 18 }}>🖨</button>
          <button onClick={() => go('tconfirm')} className="btn-primary" style={{ padding: '14px 22px', borderRadius: 12, fontSize: 15, fontWeight: 600, minHeight: 50, boxShadow: '0 6px 18px -6px rgba(23,85,47,.7)' }}>ตรวจสอบ →</button>
        </div>
      )}
    </div>
  );
}
