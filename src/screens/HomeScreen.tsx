import { useRef } from 'react';
import { useApp } from '../store/AppContext';
import { toneFor, daysUntil, usesSubstock, floorMinOf, matchesWard } from '../store/selectors';
import { nf, thDate, isoDate } from '../utils/format';
import { MedDot } from '../components/MedDot';
import { Qty, DeficitBadge } from '../components/Qty';
import { WardTabs } from '../components/WardTabs';

export default function HomeScreen() {
  const { state, myProfile, sub, fefo, bump, goReceiveFor, go, warn, pickAdjType, seedDatabase, setWardFilter } = useApp();
  const expRef = useRef<HTMLDivElement>(null);

  if (state.meds.length === 0) {
    return (
      <div style={{ padding: '14px 14px 20px', animation: 'fade .18s' }}>
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>📦</div>
          <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 6 }}>ยังไม่มีข้อมูลยาในระบบ</div>
          {myProfile?.role === 'admin' ? (
            <>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>กดเพื่อโหลดข้อมูลตั้งต้น — บัญชีเวชภัณฑ์ยา รพ.กรงปินัง 585 รายการ</div>
              <button onClick={seedDatabase} className="btn-primary" style={{ padding: '12px 20px', borderRadius: 11, fontSize: 14, fontWeight: 600 }}>โหลดข้อมูลตั้งต้น</button>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>รอ Admin โหลดข้อมูลตั้งต้นเข้าระบบก่อนใช้งาน</div>
          )}
        </div>
      </div>
    );
  }

  const allMeds = state.meds.filter((m) => m.active);
  const meds = allMeds.filter((m) => matchesWard(m, state.wardFilter));
  // "Min" (reorder point) is a separate number from "Max" (parFloor, the shelf's fill
  // target) — below Min is when it actually needs refilling this morning, not just "any bit
  // under capacity".
  const low = meds.filter((m) => m.floor < floorMinOf(m));
  // Meaningless for noSubstock meds (liquids/sprays) — they have no substock stage to be
  // low in; excluded here rather than always showing a permanent, unactionable "0/par" row.
  const lowSub = meds.filter((m) => usesSubstock(m) && sub(m.id) < m.parSub);
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

  return (
    <div style={{ padding: '14px 14px 20px', animation: 'fade .18s' }}>
      <div style={{ marginBottom: 13 }}>
        <WardTabs value={state.wardFilter} onChange={setWardFilter} />
      </div>

      <div className="grid-2 tablet-4" style={{ marginBottom: 14 }}>
        <StatTile label="ต่ำกว่าจุดต้องเติม (Min)" value={low.length} tone={low.length ? 'var(--red)' : 'var(--green)'} note="รายการ · ควรเติมวันนี้" onClick={low.length ? () => go('transfer') : undefined} />
        <StatTile label={`ใกล้หมดอายุ < ${W} วัน`} value={expLots.length} tone={expLots.length ? 'var(--amber)' : 'var(--green)'} note={`lot · รวมที่หมดอายุแล้ว ${expiredCount}`} onClick={expLots.length ? () => expRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined} />
        <StatTile label="ธุรกรรมวันนี้" value={txToday} note="รายการ · audit trail ครบ" />
        <StatTile label="ต่ำกว่า par substock" value={lowSub.length} tone={lowSub.length ? 'var(--red)' : 'var(--green)'} note="รายการ · ควรเบิกจากคลังใหญ่" onClick={lowSub.length ? () => go('receive') : undefined} />
      </div>

      <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 12, padding: '11px 13px', marginBottom: 13, fontSize: 12, color: 'var(--amber-ink)', lineHeight: 1.5 }}>
        แอปนี้ไม่บันทึกการจ่ายยา — การจ่ายจริงบันทึกใน HOSxP อยู่แล้ว ใช้แท็บ "นำเข้า HOSxP" เป็นประจำเพื่อตัดยอดหน้างานให้ตรง (เร็วกว่านับของจริง) ส่วน "นับสต็อกหน้างาน" เป็นฟังก์ชันเสริมไว้ใช้เมื่อสงสัยยอดคลาดเคลื่อน
      </div>

      <div className="grid-2 tablet-2" style={{ marginBottom: 18 }}>
        <button onClick={() => go('transfer')} className="btn btn-primary" style={{ padding: 15, textAlign: 'left', minHeight: 66 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>เติมหน้างาน</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>substock → ชั้นจ่ายยา · FEFO อัตโนมัติ</div>
        </button>
        <button onClick={() => go('receive')} className="btn btn-outline" style={{ padding: 15, textAlign: 'left', minHeight: 66 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>รับยาเข้า substock</div>
          <div className="muted" style={{ fontSize: 12 }}>ตามใบเบิกจากคลังยาใหญ่</div>
        </button>
      </div>

      <SectionHeader title="ต้องเติมหน้างาน" actionLabel="ดูทั้งหมด" onAction={() => go('transfer')} />
      <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 18 }}>
        {low.slice(0, 5).map((m) => (
          <div key={m.id} className="row-interactive" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
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
                className="btn-outline"
                style={{ padding: '9px 13px', borderRadius: 9, fontSize: 13, fontWeight: 600, flex: 'none', minHeight: 40, border: '1px solid var(--green)' }}
              >
                {state.cart[m.id] ? 'ในรายการ' : '+ ' + nf(Math.min(sub(m.id), m.parFloor - m.floor))}
              </button>
            ) : (
              <button
                onClick={() => goReceiveFor(m.id)}
                className="btn-outline"
                title="ยานี้ไม่มี substock — รับเข้าแล้วขึ้นหน้างานทันที"
                style={{ padding: '9px 13px', borderRadius: 9, fontSize: 13, fontWeight: 600, flex: 'none', minHeight: 40, border: '1px solid var(--amber)' }}
              >
                รับเข้า
              </button>
            )}
          </div>
        ))}
        {low.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่มีรายการต่ำกว่า par หน้างาน</div>}
      </div>

      <SectionHeader title="ควรเบิกจากคลังยาใหญ่" actionLabel="ไปหน้ารับเข้า" onAction={() => go('receive')} />
      <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 18 }}>
        {lowSub.slice(0, 5).map((m) => (
          <div key={m.id} className="row-interactive" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
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
            <button onClick={() => goReceiveFor(m.id)} className="btn-outline" style={{ padding: '9px 13px', borderRadius: 9, fontSize: 13, fontWeight: 600, flex: 'none', minHeight: 40, border: '1px solid var(--green)' }}>รับเข้า</button>
          </div>
        ))}
        {lowSub.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>substock ยังสูงกว่า par ทุกรายการ</div>}
      </div>

      <div ref={expRef} style={{ fontSize: 14.5, fontWeight: 600, margin: '0 2px 8px' }}>ใกล้หมดอายุ</div>
      <div className="card stagger" style={{ overflow: 'hidden' }}>
        {expLots.slice(0, 5).map((l) => {
          const m = meds.find((x) => x.id === l.medId);
          if (!m) return null;
          const d = daysUntil(l.exp);
          return (
            <div key={l.id} className="row-interactive" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ width: 52, flex: 'none', textAlign: 'center', background: d < 30 ? 'var(--red-bg)' : 'var(--amber-bg)', color: d < 30 ? 'var(--red)' : 'var(--amber-ink)', borderRadius: 8, padding: '6px 2px' }}>
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
                style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', padding: '8px 11px', borderRadius: 9, fontSize: 12.5, flex: 'none', minHeight: 38 }}
              >
                {d < 0 ? 'ตัดออก' : 'ใช้ก่อน'}
              </button>
            </div>
          );
        })}
        {expLots.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่มี lot ที่ใกล้หมดอายุ</div>}
      </div>
    </div>
  );
}

// Clickable whenever there's actually something to jump to (onClick passed) — the exact
// number a person wants to act on shouldn't be a dead end; tapping it should go straight to
// the list behind it instead of making them scroll to find the same information again.
function StatTile({ label, value, tone, note, onClick }: { label: string; value: number; tone?: string; note: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={'card stat-tile' + (onClick ? ' press-spring' : '')}
      onClick={onClick}
      style={{ padding: '12px 13px', textAlign: 'left', border: onClick ? '1px solid var(--border)' : '1px solid var(--border)', background: 'var(--bg-card)', width: '100%', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="muted" style={{ fontSize: 12, marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span>{label}</span>
        {onClick && <span style={{ color: 'var(--green)', fontSize: 13, flex: 'none' }}>→</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: tone || 'var(--ink)' }}>{value.toLocaleString('en-US')}</div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{note}</div>
    </Tag>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 2px 8px' }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
      <button onClick={onAction} style={{ border: 0, background: 'transparent', color: 'var(--green)', fontSize: 12.5, fontWeight: 600, padding: 0 }}>{actionLabel}</button>
    </div>
  );
}
