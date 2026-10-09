import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { subQty, daysUntil, toneFor, subTone } from '../store/selectors';
import { nf, thDate } from '../utils/format';
import { MedDot } from '../components/MedDot';
import { Qty } from '../components/Qty';
import { WardBadge } from '../components/WardBadge';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { NumberStepper } from '../components/NumberStepper';
import type { AdjType } from '../types';

const TYPES: [AdjType, string, string][] = [
  ['adjust', 'ปรับยอด', 'นับได้ต่างจากระบบ'],
  ['return', 'คืนยา', 'ผู้ป่วยคืน / เหลือจากหน่วยงาน'],
  ['damaged', 'ยาเสีย / ชำรุด', 'แตก หก ฉลากหลุด'],
  ['expired', 'ยาหมดอายุ', 'ตัดออกจาก substock'],
];

// Real-world request: "อยากให้ปรับเหตุผลการคืนมีให้เลือกตามนี้คือ ปรับเปลี่ยนการรักษา
// แพ้ยา/ผลข้างเคียงการรักษา Non-compliance ได้ยาเกินจากวันนัดรอบก่อน ไม่ประสงค์รับยา
// ยาตามอาการเหลือ ยาโรคเรื้อรังเหลือเยอะ อื่นๆมีให้ใส่ข้อความเองได้" — replaces the old generic
// 3-chip list with the real clinical-return reasons staff actually pick from. "อื่นๆ" below isn't
// a real list item — it's a synthetic chip (see customReasonOpen in the component) that reveals a
// free-text input instead; nothing is ever literally stored as the word "อื่นๆ".
const REASONS: Record<AdjType, string[]> = {
  adjust: ['นับได้ต่างจากระบบ', 'บันทึกจ่ายผิดรายการ', 'เบิกใช้ในหน่วยงาน'],
  return: ['ปรับเปลี่ยนการรักษา', 'แพ้ยา/ผลข้างเคียงการรักษา', 'Non-compliance', 'ได้ยาเกินจากวันนัดรอบก่อน', 'ไม่ประสงค์รับยา', 'ยาตามอาการเหลือ', 'ยาโรคเรื้อรังเหลือเยอะ'],
  damaged: ['ภาชนะแตก/หก', 'ฉลากหลุด ระบุไม่ได้', 'เก็บผิดอุณหภูมิ'],
  expired: [],
};

// commitAdjust (AppContext.tsx) always treats this field as a DELTA to apply on top of the
// current floor — never the new total. That's unambiguous for "คืนยา"/"ยาเสีย" (you naturally
// think "how many came back / broke"), but "ปรับยอด" is genuinely risky: its own reason chip
// says "นับได้ต่างจากระบบ", which invites typing the number you just counted — an ABSOLUTE
// value — into a field that actually subtracts whatever you type. Real failure mode: system
// says 8, you count 5, you type "5" expecting the result to become 5; the field instead
// computes 8-5=3, a silent 2-unit stock error nobody would notice at the time. Label + a
// visible warning (adjust only, since that's the only type this specific mix-up applies to)
// close that gap without touching commitAdjust's actual math.
const QTY_LABEL: Record<AdjType, string> = {
  adjust: 'ส่วนต่างที่จะลบออกจากยอดระบบ',
  return: 'จำนวนที่คืน (จะเพิ่มเข้ายอด)',
  damaged: 'จำนวนที่เสีย/ชำรุด (จะลบออกจากยอด)',
  expired: '',
};

export default function AdjustScreen() {
  const {
    state, pickAdjType, setAdjSearch, pickAdjMed, setAdjQty, setAdjReason, setAdjNote, setAdjHn, commitAdjust, commitSingleReturn, addToReturnCart, removeReturnCartItem, commitReturnCart, scrapLot, scrapFloorLot, go,
    goSubstockCardFor,
  } = useApp();
  const meds = state.meds.filter((m) => m.active);
  const adjMed = state.adjMed ? meds.find((m) => m.id === state.adjMed) : null;
  // OPD/IPD ward tabs removed — one combined picker across the whole formulary.
  const options = !state.adjMed && state.adjSearch.trim()
    ? meds.filter((m) => { const s = state.adjSearch.trim().toLowerCase(); return m.name.toLowerCase().indexOf(s) >= 0 || m.code.toLowerCase().indexOf(s) >= 0; }).slice(0, 10)
    : [];

  // "อื่นๆ" (คืนยา only) reveals a free-text reason input instead of picking a preset chip — the
  // typed text itself becomes state.adjReason (never the literal word "อื่นๆ"), so nothing
  // downstream (commitAdjust, DrugReturnRecord, reports) needs to know this mode exists at all.
  // Local, not global AppContext state: purely a "which input is showing" UI toggle — picking any
  // preset chip switches it back off, same as it switching on is a plain click handler.
  const [customReasonOpen, setCustomReasonOpen] = useState(false);

  // Real-world request: "อยากให้เลือกคืนยาได้ทั้งแบบทีละตัวยา หรือทีละหลายๆตัวยา" — which
  // submit flow (direct commitSingleReturn vs queue-then-batch addToReturnCart/commitReturnCart)
  // the per-drug section further down uses. Local, not global AppContext state: purely a "which
  // button/flow is showing" UI toggle, same shape as customReasonOpen above — no need to survive
  // a crash/reload the way the actual in-progress cart data (state.returnCart) does.
  const [returnMode, setReturnMode] = useState<'single' | 'batch'>('single');

  const scrapRows = state.lots
    .filter((l) => l.qty > 0 && daysUntil(l.exp) <= 30)
    .sort((a, b) => a.exp - b.exp)
    .map((l) => ({ l, m: meds.find((x) => x.id === l.medId) }))
    .filter((x): x is { l: typeof x.l; m: NonNullable<typeof x.m> } => !!x.m);

  // Floor-lot tracking follow-up (see FloorLot in types.ts): same soonest-expiring-first scrap
  // list as substock's scrapRows above, but for floorLots — best-effort by nature (see that
  // type's own doc comment), so this is a secondary bookkeeping cleanup list, not a claim that
  // real floor stock is being removed (that's still commitAdjust's "ยาเสีย/หมดอายุ" job, same as
  // always — scrapFloorLot only corrects the floor-lot BATCH record, never Med.floor itself).
  const floorScrapRows = state.floorLots
    .filter((l) => l.qty > 0 && daysUntil(l.exp) <= 30)
    .sort((a, b) => a.exp - b.exp)
    .map((l) => ({ l, m: meds.find((x) => x.id === l.medId) }))
    .filter((x): x is { l: typeof x.l; m: NonNullable<typeof x.m> } => !!x.m);

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="grid-2" style={{ marginBottom: 13 }}>
        {TYPES.map(([t, label, sub]) => {
          const active = state.adjType === t;
          return (
            <button
              key={t}
              onClick={() => { setCustomReasonOpen(false); pickAdjType(t); }}
              style={{ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? 'var(--ink-soft)' : 'var(--ink)', padding: '13px 12px', borderRadius: 12, textAlign: 'left', minHeight: 64 }}
            >
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 11.5, opacity: 0.72, lineHeight: 1.35 }}>{sub}</div>
            </button>
          );
        })}
      </div>

      {state.adjType === 'expired' && (
        <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 13 }}>
          <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 13, color: 'var(--muted)' }}>lot ที่หมดอายุแล้วหรือเหลือไม่เกิน 30 วัน — ตัดออกจาก substock พร้อมบันทึกเหตุผล</div>
          {scrapRows.map(({ l, m }) => {
            const d = daysUntil(l.exp);
            return (
              <div key={l.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>{m.name} <WardBadge med={m} /></div>
                  <div style={{ fontSize: 11.5, marginTop: 2, color: d < 0 ? 'var(--red)' : 'var(--amber)' }}>lot {l.lotNo} · exp {thDate(l.exp)} · {nf(l.qty)} {m.unit} · มูลค่า {nf(l.qty * m.price)} บาท</div>
                </div>
                <button onClick={() => scrapLot(l.id)} disabled={!!state.busy[`scrapLot:${l.id}`]} className="btn-danger" style={{ padding: '9px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, flex: 'none', minHeight: 44, opacity: state.busy[`scrapLot:${l.id}`] ? 0.7 : 1 }}>
                  {state.busy[`scrapLot:${l.id}`] ? 'กำลังตัด…' : 'ตัดออก'}
                </button>
              </div>
            );
          })}
          {scrapRows.length === 0 && <EmptyState icon="✅" title="ไม่มี lot ใกล้หมดอายุ" sub="ทุก lot ใน substock ตอนนี้ยังเหลืออายุมากกว่า 30 วัน" />}
        </div>
      )}

      {state.adjType === 'expired' && floorScrapRows.length > 0 && (
        <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 13 }}>
          <div style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', fontSize: 13, color: 'var(--muted)' }}>
            lot บนชั้นยา (หน้างาน) ที่หมดอายุแล้วหรือเหลือไม่เกิน 30 วัน — ข้อมูล lot นี้เป็นค่าประมาณ (best-effort) ตัดออกเฉพาะข้อมูล lot เท่านั้น ถ้ายามีจริงบนชั้น ให้บันทึก "ยาเสีย/หมดอายุ" แยกอีกครั้ง
          </div>
          {floorScrapRows.map(({ l, m }) => {
            const d = daysUntil(l.exp);
            return (
              <div key={l.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>{m.name} <WardBadge med={m} /></div>
                  <div style={{ fontSize: 11.5, marginTop: 2, color: d < 0 ? 'var(--red)' : 'var(--amber)' }}>lot {l.lotNo} · exp {thDate(l.exp)} · {nf(l.qty)} {m.unit}</div>
                </div>
                <button onClick={() => scrapFloorLot(l.id)} disabled={!!state.busy[`scrapFloorLot:${l.id}`]} className="btn-danger" style={{ padding: '9px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, flex: 'none', minHeight: 44, opacity: state.busy[`scrapFloorLot:${l.id}`] ? 0.7 : 1 }}>
                  {state.busy[`scrapFloorLot:${l.id}`] ? 'กำลังตัด…' : 'ตัดออก'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {state.adjType && state.adjType !== 'expired' && (
        <div className="card" style={{ padding: 12, marginBottom: 13 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 9 }}>
            {state.adjType === 'adjust' ? 'ปรับยอดตามที่นับได้' : state.adjType === 'return' ? 'รับคืนยาเข้าหน้างาน' : 'ตัดยาเสีย / ชำรุด'}
          </div>

          {state.adjType === 'return' && (
            // Real-world request: "อยากให้เลือกคืนยาได้ทั้งแบบทีละตัวยา หรือทีละหลายๆตัวยา" —
            // ทีละหลายตัว (batch) is genuinely better for one patient returning several drugs
            // (see ตะกร้าคืนยา's own comment further down), but it costs the common one-drug
            // case a second tap ("+ เพิ่มลงตะกร้า" then "บันทึกรับคืนทั้งหมด"). ทีละตัว (single)
            // trades that batching away for a single direct commit per drug — both share the
            // same HN/search/qty/reason/note fields below; only the final action button differs
            // (see commitSingleReturn vs addToReturnCart in AppContext.tsx).
            <div className="grid-2" style={{ marginBottom: 9, gap: 7 }}>
              {([['single', 'ทีละตัว'], ['batch', 'ทีละหลายตัว']] as const).map(([m, label]) => {
                const active = returnMode === m;
                return (
                  <button key={m} onClick={() => setReturnMode(m)} className="chip" style={{ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green-tint)' : 'var(--bg-card)', color: active ? 'var(--green)' : 'var(--ink)', minHeight: 44, fontWeight: 600 }}>
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {state.adjType === 'return' && (
            // HN used to live inside the per-drug section below and get wiped after every single
            // commit, forcing a retype for the SAME patient's next drug. Moved up front, entered
            // once per patient: the med-picker section further down only appears once this has
            // something in it, so the flow is naturally HN-first, then (ทีละหลายตัว) add as many
            // drugs as this one patient is returning before one final batch commit, or (ทีละตัว)
            // commit each drug immediately and move on to the next patient.
            <label style={{ display: 'block', marginBottom: 9 }}>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>HN ผู้ป่วย (บังคับ — กรอกครั้งเดียวต่อผู้ป่วย 1 คน)</span>
              <input
                value={state.adjHn}
                onChange={(e) => setAdjHn(e.target.value)}
                placeholder="เช่น 1234567"
                style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 16, minHeight: 44 }}
              />
            </label>
          )}

          {state.adjType === 'return' && state.returnCart.length > 0 && (
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, overflow: 'hidden', marginBottom: 9 }}>
              {state.returnCart.map((it, i) => (
                <div key={i} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.medName}</div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{nf(it.qty)} {it.unit} · {it.reason}</div>
                  </div>
                  <button onClick={() => removeReturnCartItem(i)} style={{ border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12.5, flex: 'none', minHeight: 44, minWidth: 44 }}>ลบ</button>
                </div>
              ))}
            </div>
          )}

          {(state.adjType !== 'return' || !!state.adjHn.trim()) && (
          <>
          <SearchInput
            value={state.adjSearch}
            onChange={setAdjSearch}
            placeholder="ค้นหาชื่อยา"
            style={{ marginBottom: 9 }}
            onEnter={options.length === 1 ? () => pickAdjMed(options[0].id) : undefined}
          />

          {options.length > 0 && (
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 158, overflowY: 'auto', marginBottom: 9 }}>
              {options.map((m) => (
                // Real-world request: same "ดูบัตรสต็อก" pattern ReceiveScreen's own search
                // results already have — a plain <div role="button"> (not a real <button>) since
                // picking this med to adjust is still this row's own primary action, and a real
                // <button> can't contain the nested CardPeekButton <button>.
                <div key={m.id} role="button" tabIndex={0} className="row-interactive" onClick={() => pickAdjMed(m.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickAdjMed(m.id); } }} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 8px 10px 12px', minHeight: 44, cursor: 'pointer' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}><MedDot code={m.code} /> {m.name} <WardBadge med={m} /></span>
                    <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>หน้างาน <Qty value={m.floor} tone={toneFor(m)} size={11.5} /> · substock <Qty value={subQty(state, m.id)} tone={subTone(subQty(state, m.id), m.parSub)} unit={m.unit} size={11.5} /></span>
                  </div>
                  <CardPeekButton medId={m.id} name={m.name} onOpen={goSubstockCardFor} />
                </div>
              ))}
            </div>
          )}

          {adjMed && (
            <>
              <div style={{ background: 'var(--green-tint)', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, fontWeight: 600, marginBottom: 9 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}><MedDot code={adjMed.code} /> {adjMed.name} <WardBadge med={adjMed} size="md" /></span>
                <span className="muted" style={{ display: 'block', fontSize: 11.5, fontWeight: 400 }}>หน้างาน <Qty value={adjMed.floor} tone={toneFor(adjMed)} size={11.5} /> · substock <Qty value={subQty(state, adjMed.id)} tone={subTone(subQty(state, adjMed.id), adjMed.parSub)} unit={adjMed.unit} size={11.5} /></span>
              </div>
              {state.adjType === 'adjust' && (
                <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, padding: '10px 12px', fontSize: 12, lineHeight: 1.55, color: 'var(--amber-ink)', marginBottom: 9 }}>
                  ⚠️ ช่องนี้คือ<b>ส่วนต่าง</b>ที่จะถูกลบออก ไม่ใช่ยอดที่นับได้ทั้งหมด — เช่น ระบบบอก 8 นับได้จริง 5
                  ต้องกรอก <b>3</b> (ส่วนต่าง) ไม่ใช่ 5 ถ้าต้องการกรอก<b>ยอดที่นับได้จริง</b>โดยตรงและให้ระบบคำนวณส่วนต่างให้เอง
                  แนะนำใช้{' '}
                  <button type="button" onClick={() => go('count')} style={{ border: 0, background: 'transparent', color: 'var(--amber-ink)', textDecoration: 'underline', fontWeight: 700, padding: 0, fontSize: 12 }}>
                    หน้า "นับสต๊อก" แทน →
                  </button>
                </div>
              )}
              <label style={{ display: 'block', marginBottom: 9 }}>
                <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{QTY_LABEL[state.adjType]} ({adjMed.unit})</span>
                {/* คืนยา/ปรับยอด deliberately keep plain tablet-count entry (no packSize prop) —
                    "ยาคืนส่วนใหญ่ไม่ได้คืนเป็นกล่อง" — unlike every other qty field in the app,
                    which now defaults to box-primary entry (see NumberStepper's packSize prop). */}
                <NumberStepper value={state.adjQty} onChange={setAdjQty} unit={adjMed.unit} />
              </label>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>เหตุผล (บังคับ)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 9 }}>
                {REASONS[state.adjType].map((r) => {
                  const active = !customReasonOpen && state.adjReason === r;
                  return (
                    // Bug fix (accessibility): 38px, under the 44px minimum touch target.
                    <button key={r} onClick={() => { setCustomReasonOpen(false); setAdjReason(r); }} className="chip" style={{ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green-tint)' : 'var(--bg-card)', color: active ? 'var(--green)' : 'var(--ink)', minHeight: 44 }}>{r}</button>
                  );
                })}
                {/* Real-world request: "อื่นๆมีให้ใส่ข้อความเองได้" — คืนยา only, since the other
                    types (ปรับยอด/ยาเสีย) keep their original fixed reason lists untouched. */}
                {state.adjType === 'return' && (
                  <button onClick={() => { setCustomReasonOpen(true); setAdjReason(''); }} className="chip" style={{ border: customReasonOpen ? '1px solid var(--green)' : '1px solid var(--border)', background: customReasonOpen ? 'var(--green-tint)' : 'var(--bg-card)', color: customReasonOpen ? 'var(--green)' : 'var(--ink)', minHeight: 44 }}>อื่นๆ</button>
                )}
              </div>
              {customReasonOpen && state.adjType === 'return' && (
                <input
                  value={state.adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="ระบุเหตุผลการคืนยา"
                  autoFocus
                  style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 14, marginBottom: 9, minHeight: 44 }}
                />
              )}
              <textarea
                value={state.adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                placeholder="รายละเอียดเพิ่มเติม เช่น เลข lot ที่นับได้ต่าง ผู้ร่วมตรวจนับ"
                style={{ width: '100%', minHeight: 66, border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 13.5, resize: 'vertical' }}
              />
              {(() => {
                const isReturn = state.adjType === 'return';
                const isSingleReturn = isReturn && returnMode === 'single';
                const canSubmit = !!state.adjReason && !!state.adjQty && (!isSingleReturn || !!state.adjHn.trim());
                const busyKey = isSingleReturn ? 'returnSingle' : 'adjust';
                const onClick = isSingleReturn ? commitSingleReturn : isReturn ? addToReturnCart : commitAdjust;
                // ทีละหลายตัว's "+ เพิ่มลงตะกร้า" is local state only (addToReturnCart), never
                // busy-gated; ทีละตัว's "บันทึกรับคืน" and ปรับยอด/ยาเสีย's commit both hit
                // Firestore, so both need the busy guard.
                const isNetworked = !isReturn || isSingleReturn;
                return (
                  <button
                    onClick={onClick}
                    disabled={!canSubmit || (isNetworked && !!state.busy[busyKey])}
                    style={{ width: '100%', border: 0, background: canSubmit ? 'var(--green)' : 'var(--border-strong)', color: canSubmit ? 'var(--ink-soft)' : 'var(--ink)', padding: 15, borderRadius: 11, fontSize: 15.5, fontWeight: 600, minHeight: 52, marginTop: 10, opacity: isNetworked && state.busy[busyKey] ? 0.7 : 1 }}
                  >
                    {isReturn
                      ? (isSingleReturn ? (state.busy['returnSingle'] ? 'กำลังบันทึก…' : 'บันทึกรับคืน') : '+ เพิ่มลงตะกร้า')
                      : (state.busy['adjust'] ? 'กำลังบันทึก…' : 'บันทึกปรับยอด')}
                  </button>
                );
              })()}
            </>
          )}
          </>
          )}

          {state.adjType === 'return' && state.returnCart.length > 0 && (
            <button
              onClick={commitReturnCart}
              disabled={!state.adjHn.trim() || !!state.busy['returnCart']}
              className="btn-primary"
              style={{ width: '100%', padding: 16, borderRadius: 12, fontSize: 16, minHeight: 54, marginTop: 10, opacity: state.busy['returnCart'] ? 0.7 : 1 }}
            >
              {state.busy['returnCart'] ? 'กำลังบันทึก…' : 'บันทึกรับคืนทั้งหมด (' + state.returnCart.length + ' รายการ)'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Same shape as ReceiveScreen's own CardPeekButton — a small, separate, stopPropagation'd icon
// button for a row whose own tap already does something else (picking the drug for adjustment).
function CardPeekButton({ medId, name, onOpen }: { medId: string; name: string; onOpen: (medId: string) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(medId); }}
      title={'ดูบัตรสต็อก ' + name}
      aria-label={'ดูบัตรสต็อก ' + name}
      style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--green)', fontSize: 18, padding: '4px 6px', minWidth: 44, minHeight: 44 }}
    >
      📋
    </button>
  );
}
