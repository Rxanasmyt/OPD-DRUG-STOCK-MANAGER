import { useRef } from 'react';
import { useApp } from '../store/AppContext';
import { toneFor, daysUntil, usesSubstock, floorMinOf, isUrgentLow, needsWarehouseRequest, lastReconcileDateIso } from '../store/selectors';
import { nf, thDate, isoDate } from '../utils/format';
import { MedDot } from '../components/MedDot';
import { Qty, DeficitBadge } from '../components/Qty';
import HospitalCrest from '../components/HospitalCrest';

const GREETING_DATE_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

// Bug fix (real-world request): "อรุณสวัสดิ์" + a mood weather icon (🌤️☀️🌇🌙) read as a
// consumer lifestyle-app greeting, not a hospital pharmacy system — and this is the very
// first thing anyone sees on every single login. Kept the time-of-day awareness (still useful
// context) but swapped the wording for the plain, neutral "สวัสดีตอนเช้า/บ่าย/เย็น/ค่ำ" register
// used in official correspondence, and dropped the weather icon badge entirely — see its
// replacement with the hospital crest itself below.
function greetingFor(hour: number): string {
  if (hour < 11) return 'สวัสดีตอนเช้า';
  if (hour < 16) return 'สวัสดีตอนบ่าย';
  if (hour < 19) return 'สวัสดีตอนเย็น';
  return 'สวัสดีตอนค่ำ';
}

// Maps a severity tone token to its matching pale-tint token — every card/badge on this screen
// that colors itself by tone uses the same tint family instead of each inventing its own, so
// "this number is bad news" reads consistently everywhere on the dashboard, not just per-widget.
function toneTint(tone?: string): string {
  if (tone === 'var(--red)') return 'var(--red-bg)';
  if (tone === 'var(--amber)') return 'var(--amber-bg)';
  if (tone === 'var(--green)') return 'var(--green-tint)';
  return 'var(--bg-subtle)';
}

// Shared "elevated, borderless" surface style for this screen's cards — shadow does the job a
// flat 1px border used to do, which is most of what made the previous layout read as a grid of
// plain boxes rather than a designed dashboard. Kept local to HomeScreen (not a global .card
// override) so the rest of the app's existing bordered-card look is untouched.
const surface: React.CSSProperties = { background: 'var(--bg-card)', borderRadius: 18, boxShadow: 'var(--shadow-xs)' };

export default function HomeScreen() {
  const { state, myProfile, sub, fefo, bump, goReceiveFor, go, warn, pickAdjType, seedDatabase, roleLabel } = useApp();
  const expRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const greeting = greetingFor(now.getHours());

  if (state.meds.length === 0) {
    return (
      <div style={{ padding: '16px 14px 24px', animation: 'fade .18s' }}>
        <div style={{ ...surface, padding: '32px 22px', textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: 'var(--green-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 16px' }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 7 }}>ยังไม่มีข้อมูลยาในระบบ</div>
          {myProfile?.role === 'admin' ? (
            <>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 18 }}>กดเพื่อโหลดข้อมูลตั้งต้น — บัญชีเวชภัณฑ์ยา รพ.กรงปินัง 585 รายการ</div>
              <button onClick={seedDatabase} className="btn-primary press-spring" style={{ padding: '13px 22px', borderRadius: 13, fontSize: 14, fontWeight: 700 }}>โหลดข้อมูลตั้งต้น</button>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>รอ Admin โหลดข้อมูลตั้งต้นเข้าระบบก่อนใช้งาน</div>
          )}
        </div>
      </div>
    );
  }

  // OPD/IPD ward tabs removed — every med now shows in one combined list (see
  // shareAllMeds()/matchesWard() in AppContext.tsx/selectors.ts; wardFilter stays 'all').
  const meds = state.meds.filter((m) => m.active);
  // "Min" (reorder point) is a separate number from "Max" (parFloor, the shelf's fill
  // target) — below Min is when it actually needs refilling this morning, not just "any bit
  // under capacity".
  const low = meds.filter((m) => m.floor < floorMinOf(m));
  // Meaningless for noSubstock meds (liquids/sprays) — they have no substock stage to be
  // low in; excluded here rather than always showing a permanent, unactionable "0/par" row.
  const lowSub = meds.filter((m) => usesSubstock(m) && sub(m.id) < m.parSub);
  // "สรุปงานวันนี้" checklist — combines the handful of things someone covering this app alone
  // has to currently piece together from several separate screens every morning (เร่งด่วนวันนี้
  // on TransferScreen, pending approvals on ReceiveScreen, ตัดยอด HOSxP status on
  // ReconcileScreen, the warehouse-request count) into one glance here instead.
  const urgent = meds.filter((m) => usesSubstock(m) && isUrgentLow(m));
  const needsWarehouse = meds.filter((m) => needsWarehouseRequest(m, sub(m.id)));
  const pendingApprovals = myProfile?.role !== 'tech' ? state.pending : 0;
  const W = warn();
  const medIds = new Set(meds.map((m) => m.id));
  const wardLots = state.lots.filter((l) => medIds.has(l.medId));
  const expLots = wardLots
    .filter((l) => l.qty > 0 && daysUntil(l.exp) < W)
    .sort((a, b) => a.exp - b.exp);
  const expiredCount = wardLots.filter((l) => l.qty > 0 && daysUntil(l.exp) < 0).length;
  // Bug fix: daysUntil() computes days remaining until a *future* timestamp (right for
  // expiry dates) — for a tx.ts, which is always in the past, it was always negative, so
  // this tile silently showed 0 for every transaction ever logged. Compare calendar dates.
  const todayIso = isoDate(Date.now());
  const txToday = state.txs.filter((x) => isoDate(x.ts) === todayIso).length;
  // Whether today's HOSxP reconcile (the main way this app's floor numbers stay honest — see
  // the tip banner below) has actually run yet. A real, recurring risk for a short-staffed
  // team: skip a day and the app quietly drifts from what's actually on the shelf, with
  // nothing else here to catch it. lastReconcileDateIso() reads state.txs (already loaded,
  // newest-first), so this needs no extra query.
  const reconciledToday = lastReconcileDateIso(state.txs) === todayIso;

  // Overview ring — same red/amber/green severity toneFor() already uses for a single med's
  // floor-vs-par row (TransferScreen etc.), rolled up across the whole active formulary into
  // one glanceable picture instead of making someone infer it from four separate numbers.
  const healthyCount = meds.filter((m) => toneFor(m) === 'var(--green)').length;
  const warnCount = meds.filter((m) => toneFor(m) === 'var(--amber)').length;
  const criticalCount = meds.length - healthyCount - warnCount;

  return (
    <div style={{ padding: '16px 14px 24px', animation: 'fade .18s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 2px 16px' }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'radial-gradient(circle at 35% 30%, #ffffff, #f4f2ec)', border: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 7, flex: 'none' }}>
          <HospitalCrest size={28} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17.5, fontWeight: 800, lineHeight: 1.25, letterSpacing: '-.01em' }}>
            {greeting}{myProfile?.name ? ', ' + myProfile.name.replace(/^(ภญ\.|ภก\.|จพ\.|กภ\.)\s*/, '') : ''}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {now.toLocaleDateString('th-TH', GREETING_DATE_FMT)} · {roleLabel()}
          </div>
        </div>
      </div>

      <div style={{ ...surface, position: 'relative', overflow: 'hidden', padding: '19px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 18 }}>
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 140% at 102% -12%, rgba(var(--green-rgb), .09), transparent 55%)', pointerEvents: 'none' }}
        />
        <HealthRing healthy={healthyCount} warn={warnCount} critical={criticalCount} size={84} stroke={11} />
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em', marginBottom: 10, textTransform: 'uppercase' }}>
            ภาพรวมหน้างาน · {nf(meds.length)} รายการ
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <HealthLegendRow color="var(--green)" label="ปกติ" count={healthyCount} />
            <HealthLegendRow color="var(--amber)" label="เริ่มต่ำ" count={warnCount} />
            <HealthLegendRow color="var(--red)" label="ต่ำกว่า 34% ของ par" count={criticalCount} onClick={criticalCount ? () => go('transfer') : undefined} />
          </div>
        </div>
      </div>

      {/* "สรุปงานวันนี้" — รวมสิ่งที่ต้องเช็คทุกเช้าจากหลายหน้าแยกกัน (เร่งด่วนวันนี้ที่หน้าเติม
          หน้างาน, ตัดยอด HOSxP แล้วหรือยัง, คำขอรับเข้าที่รออนุมัติ, ควรเบิกจากคลังใหญ่) ไว้ที่
          เดียว ให้คนเดียวที่คุมทั้งระบบเห็นภาพงานวันนี้ได้ในแวบเดียวไม่ต้องไล่แตะทีละแท็บ */}
      <div style={{ ...surface, padding: '14px 15px', marginBottom: 16 }}>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.03em', marginBottom: 10, textTransform: 'uppercase' }}>สรุปงานวันนี้</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ChecklistRow
            icon="🔴" label="ยาเร่งด่วนวันนี้" value={urgent.length ? urgent.length + ' รายการ' : 'ไม่มี'}
            tone={urgent.length ? 'var(--red)' : 'var(--green)'} onClick={() => go('transfer')}
          />
          <ChecklistRow
            icon="🧾" label="ตัดยอด HOSxP วันนี้" value={reconciledToday ? 'ทำแล้ว ✓' : 'ยังไม่ได้ทำ'}
            tone={reconciledToday ? 'var(--green)' : 'var(--amber)'} onClick={() => go('reconcile')}
          />
          {myProfile?.role !== 'tech' && (
            <ChecklistRow
              icon="📥" label="คำขอรับเข้าที่รออนุมัติ" value={pendingApprovals ? pendingApprovals + ' รายการ' : 'ไม่มี'}
              tone={pendingApprovals ? 'var(--amber)' : 'var(--green)'} onClick={() => go('receive')}
            />
          )}
          <ChecklistRow
            icon="📦" label="ควรเบิกจากคลังใหญ่" value={needsWarehouse.length ? needsWarehouse.length + ' รายการ' : 'ไม่มี'}
            tone={needsWarehouse.length ? 'var(--amber)' : 'var(--green)'} onClick={() => go('receive')}
          />
        </div>
      </div>

      <div className="grid-2 tablet-4" style={{ marginBottom: 16 }}>
        <StatTile icon="🔻" label="ต่ำกว่าจุดต้องเติม (Min)" value={low.length} tone={low.length ? 'var(--red)' : 'var(--green)'} note="ควรเติมวันนี้" onClick={low.length ? () => go('transfer') : undefined} />
        <StatTile icon="⏳" label={`ใกล้หมดอายุ < ${W} วัน`} value={expLots.length} tone={expLots.length ? 'var(--amber)' : 'var(--green)'} note={`รวมที่หมดแล้ว ${expiredCount}`} onClick={expLots.length ? () => expRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined} />
        <StatTile icon="📋" label="ธุรกรรมวันนี้" value={txToday} note="audit trail ครบ" />
        <StatTile icon="📦" label="ต่ำกว่า par substock" value={lowSub.length} tone={lowSub.length ? 'var(--red)' : 'var(--green)'} note="ควรเบิกจากคลังใหญ่" onClick={lowSub.length ? () => go('receive') : undefined} />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 16, padding: '12px 14px', marginBottom: 16 }}>
        <span aria-hidden="true" style={{ fontSize: 14, flex: 'none', lineHeight: 1.4 }}>💡</span>
        <span style={{ fontSize: 12, color: 'var(--amber-ink)', lineHeight: 1.55 }}>
          แอปนี้ไม่บันทึกการจ่ายยา — การจ่ายจริงบันทึกใน HOSxP อยู่แล้ว ใช้แท็บ "นำเข้า HOSxP" เป็นประจำเพื่อตัดยอดหน้างานให้ตรง (เร็วกว่านับของจริง) ส่วน "นับสต็อกหน้างาน" เป็นฟังก์ชันเสริมไว้ใช้เมื่อสงสัยยอดคลาดเคลื่อน
        </span>
      </div>

      <div className="grid-2 tablet-2" style={{ marginBottom: 22 }}>
        <button
          onClick={() => go('transfer')}
          className="press-spring"
          style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', border: 0, borderRadius: 16, background: 'linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%)', color: 'var(--ink-soft)', padding: '15px 16px', minHeight: 74, boxShadow: 'var(--shadow-md)' }}
        >
          <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: 'none' }}>⇄</span>
          <span style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>เติมหน้างาน</div>
            <div style={{ fontSize: 11.5, opacity: .78, marginTop: 2, lineHeight: 1.4 }}>substock → ชั้นจ่ายยา · FEFO อัตโนมัติ</div>
          </span>
        </button>
        <button
          onClick={() => go('receive')}
          className="press-spring"
          style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', border: '1px solid var(--border)', borderRadius: 16, background: 'var(--bg-card)', color: 'var(--ink)', padding: '15px 16px', minHeight: 74, boxShadow: 'var(--shadow-xs)' }}
        >
          <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--green-tint)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flex: 'none' }}>⬓</span>
          <span style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>รับยาเข้า substock</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.4 }}>ตามใบเบิกจากคลังยาใหญ่</div>
          </span>
        </button>
      </div>

      <SectionHeader title="ต้องเติมหน้างาน" actionLabel="ดูทั้งหมด" onAction={() => go('transfer')} accent="var(--red)" />
      <div className="stagger" style={{ ...surface, overflow: 'hidden', marginBottom: 22 }}>
        {low.slice(0, 5).map((m) => (
          <div key={m.id} className="row-interactive" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                <MedDot code={m.code} />
                <span>{m.name}</span>
                {m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}>HAD</span>}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                หน้างาน <Qty value={m.floor} tone={toneFor(m)} size={12.5} /> · Min {nf(floorMinOf(m))} / Max {nf(m.parFloor)} · substock {nf(sub(m.id))} {m.unit}
              </div>
              <div className="bar-track" style={{ height: 4, background: 'var(--border-soft)', borderRadius: 2, marginTop: 6 }}>
                <div className="bar-fill" style={{ height: '100%', width: Math.max(3, Math.min(100, Math.round((m.floor / m.parFloor) * 100))) + '%', background: toneFor(m), borderRadius: 2 }} />
              </div>
              <div style={{ marginTop: 6 }}>
                <DeficitBadge amount={Math.max(0, m.parFloor - m.floor)} unit={m.unit} urgent={m.floor < floorMinOf(m) * 0.5} />
              </div>
            </div>
            {usesSubstock(m) ? (
              <button
                onClick={() => { bump(m.id, 1); go('transfer'); }}
                className="btn-outline press-spring"
                style={{ padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 700, flex: 'none', minHeight: 40, border: '1px solid var(--green)' }}
              >
                {state.cart[m.id] ? 'ในรายการ' : '+ ' + nf(Math.min(sub(m.id), m.parFloor - m.floor))}
              </button>
            ) : (
              <button
                onClick={() => goReceiveFor(m.id)}
                className="btn-outline press-spring"
                title="ยานี้ไม่มี substock — รับเข้าแล้วขึ้นหน้างานทันที"
                style={{ padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 700, flex: 'none', minHeight: 40, border: '1px solid var(--amber)', color: 'var(--amber-ink)' }}
              >
                รับเข้า
              </button>
            )}
          </div>
        ))}
        {low.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่มีรายการต่ำกว่า par หน้างาน</div>}
      </div>

      <SectionHeader title="ควรเบิกจากคลังยาใหญ่" actionLabel="ไปหน้ารับเข้า" onAction={() => go('receive')} accent="var(--amber)" />
      <div className="stagger" style={{ ...surface, overflow: 'hidden', marginBottom: 22 }}>
        {lowSub.slice(0, 5).map((m) => (
          <div key={m.id} className="row-interactive" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                <MedDot code={m.code} />
                <span>{m.name}</span>
                {m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}>HAD</span>}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                substock <Qty value={sub(m.id)} tone="var(--red)" size={12.5} /> / par {nf(m.parSub)}
              </div>
              <div style={{ marginTop: 6 }}>
                <DeficitBadge amount={Math.max(0, m.parSub - sub(m.id))} unit={m.unit} urgent={sub(m.id) === 0} />
              </div>
            </div>
            <button onClick={() => goReceiveFor(m.id)} className="btn-outline press-spring" style={{ padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 700, flex: 'none', minHeight: 40, border: '1px solid var(--green)' }}>รับเข้า</button>
          </div>
        ))}
        {lowSub.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>substock ยังสูงกว่า par ทุกรายการ</div>}
      </div>

      <div ref={expRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '0 2px 9px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ width: 4, height: 14, borderRadius: 2, background: 'var(--amber)', flex: 'none' }} />
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>ใกล้หมดอายุ</span>
        </div>
        {expLots.length > 0 && (
          <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
            {expiredCount > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}>● หมดแล้ว {nf(expiredCount)}</span>}
            {expLots.length - expiredCount > 0 && <span style={{ color: 'var(--amber-ink)', fontWeight: 700 }}>● ใกล้ครบ {nf(expLots.length - expiredCount)}</span>}
          </div>
        )}
      </div>
      <div className="stagger" style={{ ...surface, overflow: 'hidden' }}>
        {expLots.slice(0, 5).map((l) => {
          const m = meds.find((x) => x.id === l.medId);
          if (!m) return null;
          const d = daysUntil(l.exp);
          return (
            <div key={l.id} className="row-interactive" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ width: 52, flex: 'none', textAlign: 'center', background: d < 30 ? 'var(--red-bg)' : 'var(--amber-bg)', color: d < 30 ? 'var(--red)' : 'var(--amber-ink)', borderRadius: 11, padding: '6px 2px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>{d < 0 ? Math.abs(d) : d}</div>
                <div style={{ fontSize: 10, lineHeight: 1.3 }}>{d < 0 ? 'วันที่เกิน' : 'วัน'}</div>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <MedDot code={m.code} />
                  <span>{m.name}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>lot {l.lotNo} · exp {thDate(l.exp)} · เหลือ {nf(l.qty)} {m.unit}</div>
              </div>
              <button
                onClick={() => { if (d < 0) { pickAdjType('expired'); go('adjust'); } else { bump(m.id, 1); go('transfer'); } }}
                className="press-spring"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-subtle)', color: 'var(--ink)', padding: '8px 11px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, flex: 'none', minHeight: 38 }}
              >
                {d < 0 ? 'ตัดออก' : 'ใช้ก่อน'}
              </button>
            </div>
          );
        })}
        {expLots.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่มี lot ที่ใกล้หมดอายุ</div>}
      </div>
    </div>
  );
}

// Clickable whenever there's actually something to jump to (onClick passed) — the exact
// number a person wants to act on shouldn't be a dead end; tapping it should go straight to
// the list behind it instead of making them scroll to find the same information again.
function StatTile({ icon, label, value, tone, note, onClick }: { icon?: string; label: string; value: number; tone?: string; note: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  const t = tone || 'var(--ink)';
  return (
    <Tag
      className={'stat-tile' + (onClick ? ' press-spring' : '')}
      onClick={onClick}
      style={{ ...surface, border: 0, padding: '14px 14px 13px', textAlign: 'left', width: '100%', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
        {icon && (
          <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 10, background: toneTint(tone), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flex: 'none' }}>
            {icon}
          </span>
        )}
        {onClick && <span style={{ color: 'var(--muted)', fontSize: 13 }}>→</span>}
      </div>
      <div style={{ fontSize: 25, fontWeight: 800, lineHeight: 1, color: t, letterSpacing: '-.01em' }}>{value.toLocaleString('en-US')}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 1, lineHeight: 1.4 }}>{note}</div>
    </Tag>
  );
}

function SectionHeader({ title, actionLabel, onAction, accent }: { title: string; actionLabel: string; onAction: () => void; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 9px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden="true" style={{ width: 4, height: 14, borderRadius: 2, background: accent || 'var(--green)', flex: 'none' }} />
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>{title}</span>
      </div>
      <button onClick={onAction} className="press-spring" style={{ display: 'flex', alignItems: 'center', gap: 3, border: 0, background: 'transparent', color: 'var(--green)', fontSize: 12.5, fontWeight: 700, padding: '4px 2px' }}>
        {actionLabel} <span aria-hidden="true" style={{ fontSize: 11 }}>→</span>
      </button>
    </div>
  );
}

// Whole-formulary "how healthy is the shelf right now" at a glance — the same red/amber/green
// severity toneFor() already computes per med, rolled into one ring instead of making someone
// mentally combine four separate stat-tile numbers to get the same picture.
// True 3-segment donut (critical/warn/healthy, drawn in that order so the more urgent slices
// anchor at the top) instead of a single-color arc against a flat track — showing the actual
// proportional split at a glance is the whole point of "เห็นภาพชัดเจน", not just one number.
// A small surface gap between segments (dataviz convention for adjacent stacked marks) keeps
// each slice visually distinct instead of reading as one blended ring.
function HealthRing({ healthy, warn, critical, size = 76, stroke = 10 }: { healthy: number; warn: number; critical: number; size?: number; stroke?: number }) {
  const total = healthy + warn + critical;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gapPx = 3;
  const segs = [
    { value: critical, color: 'var(--red)' },
    { value: warn, color: 'var(--amber)' },
    { value: healthy, color: 'var(--green)' },
  ].filter((s) => s.value > 0);
  let acc = 0;
  const healthyPct = total ? Math.round((healthy / total) * 100) : 100;
  const centerTone = healthyPct >= 80 ? 'var(--green)' : healthyPct >= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={stroke} />
        {total === 0 ? null : segs.map((s, i) => {
          const frac = s.value / total;
          const len = Math.max(0, frac * c - (segs.length > 1 ? gapPx : 0));
          const dashoffset = -acc;
          acc += frac * c;
          return (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={dashoffset}
              style={{ transition: 'stroke-dasharray var(--dur-slow) var(--ease-out), stroke-dashoffset var(--dur-slow) var(--ease-out)' }}
            />
          );
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ fontSize: Math.round(size * 0.2), fontWeight: 800, lineHeight: 1, color: centerTone }}>{healthyPct}%</div>
        <div className="muted" style={{ fontSize: Math.round(size * 0.1), marginTop: 1 }}>ปกติ</div>
      </div>
    </div>
  );
}

function HealthLegendRow({ color, label, count, onClick }: { color: string; label: string; count: number; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={onClick ? 'press-spring' : ''}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 0, background: 'transparent', padding: 0,
        textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none' }} />
      <span style={{ fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color, flex: 'none' }}>{nf(count)}</span>
      {onClick && <span aria-hidden="true" style={{ color: 'var(--muted)', fontSize: 11, flex: 'none' }}>→</span>}
    </Tag>
  );
}

/** One row of the "สรุปงานวันนี้" checklist card — an icon, a label, and a tone-colored value
 * (a count, or a plain "ทำแล้ว ✓"/"ยังไม่ได้ทำ" status), tappable straight to the screen that
 * handles it. Deliberately plainer than StatTile (no big number, no separate note line) — this
 * card is meant to be scanned as a short list, not a grid of tiles competing for attention. */
function ChecklistRow({ icon, label, value, tone, onClick }: { icon: string; label: string; value: string; tone: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="press-spring"
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 0, background: 'transparent', padding: '7px 2px', textAlign: 'left', cursor: 'pointer', borderRadius: 9 }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, flex: 'none' }}>{icon}</span>
      <span style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: tone, flex: 'none' }}>{value}</span>
      <span aria-hidden="true" style={{ color: 'var(--muted)', fontSize: 11, flex: 'none' }}>→</span>
    </button>
  );
}
