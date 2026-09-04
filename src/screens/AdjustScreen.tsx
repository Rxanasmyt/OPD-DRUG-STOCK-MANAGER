import { useApp } from '../store/AppContext';
import { subQty, daysUntil, toneFor, matchesWard } from '../store/selectors';
import { nf, thDate } from '../utils/format';
import { MedDot } from '../components/MedDot';
import { Qty } from '../components/Qty';
import { WardBadge } from '../components/WardBadge';
import { WardTabs } from '../components/WardTabs';
import type { AdjType } from '../types';

const TYPES: [AdjType, string, string][] = [
  ['adjust', 'ปรับยอด', 'นับได้ต่างจากระบบ'],
  ['return', 'คืนยา', 'ผู้ป่วยคืน / เหลือจากหน่วยงาน'],
  ['damaged', 'ยาเสีย / ชำรุด', 'แตก หก ฉลากหลุด'],
  ['expired', 'ยาหมดอายุ', 'ตัดออกจาก substock'],
];

const REASONS: Record<AdjType, string[]> = {
  adjust: ['นับได้ต่างจากระบบ', 'บันทึกจ่ายผิดรายการ', 'เบิกใช้ในหน่วยงาน'],
  return: ['ผู้ป่วยคืนยา (ไม่เปิดซอง)', 'เหลือจากหน่วยงาน', 'จ่ายเกินและได้รับคืน'],
  damaged: ['ภาชนะแตก/หก', 'ฉลากหลุด ระบุไม่ได้', 'เก็บผิดอุณหภูมิ'],
  expired: [],
};

export default function AdjustScreen() {
  const {
    state, pickAdjType, setAdjSearch, pickAdjMed, setAdjQty, setAdjReason, setAdjNote, commitAdjust, scrapLot, setWardFilter,
  } = useApp();
  const meds = state.meds.filter((m) => m.active);
  const adjMed = state.adjMed ? meds.find((m) => m.id === state.adjMed) : null;
  // Same shared ward filter as ReceiveScreen/TransferScreen/HomeScreen/MedsScreen — scopes
  // the picker to one zone by default so an OPD/IPD name-twin pair doesn't show side by side
  // unless "ทุกหอผู้ป่วย" is deliberately picked.
  const options = !state.adjMed && state.adjSearch.trim()
    ? meds.filter((m) => matchesWard(m, state.wardFilter) && m.name.toLowerCase().indexOf(state.adjSearch.trim().toLowerCase()) >= 0).slice(0, 10)
    : [];

  const scrapRows = state.lots
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
              onClick={() => pickAdjType(t)}
              style={{ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)', padding: '13px 12px', borderRadius: 12, textAlign: 'left', minHeight: 64 }}
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
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>{m.name} <WardBadge med={m} /></div>
                  <div style={{ fontSize: 11.5, marginTop: 2, color: d < 0 ? 'var(--red)' : 'var(--amber)' }}>lot {l.lotNo} · exp {thDate(l.exp)} · {nf(l.qty)} {m.unit} · มูลค่า {nf(l.qty * m.price)} บาท</div>
                </div>
                <button onClick={() => scrapLot(l.id)} style={{ border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', padding: '9px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, flex: 'none', minHeight: 40 }}>ตัดออก</button>
              </div>
            );
          })}
          {scrapRows.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่มี lot ใกล้หมดอายุ</div>}
        </div>
      )}

      {state.adjType && state.adjType !== 'expired' && (
        <div className="card" style={{ padding: 12, marginBottom: 13 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 9 }}>
            {state.adjType === 'adjust' ? 'ปรับยอดตามที่นับได้' : state.adjType === 'return' ? 'รับคืนยาเข้าหน้างาน' : 'ตัดยาเสีย / ชำรุด'}
          </div>
          {!adjMed && (
            <div style={{ marginBottom: 9 }}>
              <WardTabs value={state.wardFilter} onChange={setWardFilter} size="sm" />
            </div>
          )}
          <input value={state.adjSearch} onChange={(e) => setAdjSearch(e.target.value)} placeholder="ค้นหาชื่อยา" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44, marginBottom: 9 }} />

          {options.length > 0 && (
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 158, overflowY: 'auto', marginBottom: 9 }}>
              {options.map((m) => (
                <button key={m.id} onClick={() => pickAdjMed(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 12px', minHeight: 44 }}>
                  <span style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={m.code} /> {m.name} <WardBadge med={m} /></span>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>หน้างาน <Qty value={m.floor} tone={toneFor(m)} size={11.5} /> · substock {nf(subQty(state, m.id))} {m.unit}</span>
                </button>
              ))}
            </div>
          )}

          {adjMed && (
            <>
              <div style={{ background: 'var(--green-tint)', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, fontWeight: 600, marginBottom: 9 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={adjMed.code} /> {adjMed.name} <WardBadge med={adjMed} size="md" /></span>
                <span className="muted" style={{ display: 'block', fontSize: 11.5, fontWeight: 400 }}>หน้างาน <Qty value={adjMed.floor} tone={toneFor(adjMed)} size={11.5} /> · substock {nf(subQty(state, adjMed.id))} {adjMed.unit}</span>
              </div>
              <label style={{ display: 'block', marginBottom: 9 }}>
                <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>จำนวน ({adjMed.unit})</span>
                <input value={state.adjQty} onChange={(e) => setAdjQty(e.target.value)} inputMode="numeric" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 17, fontWeight: 600, minHeight: 48 }} />
              </label>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>เหตุผล (บังคับ)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 9 }}>
                {REASONS[state.adjType].map((r) => {
                  const active = state.adjReason === r;
                  return (
                    <button key={r} onClick={() => setAdjReason(r)} className="chip" style={{ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green-tint)' : 'var(--bg-card)', color: active ? 'var(--green)' : 'var(--ink)', minHeight: 38 }}>{r}</button>
                  );
                })}
              </div>
              <textarea
                value={state.adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                placeholder="รายละเอียดเพิ่มเติม เช่น เลข lot ที่นับได้ต่าง ผู้ร่วมตรวจนับ"
                style={{ width: '100%', minHeight: 66, border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 13.5, resize: 'vertical' }}
              />
              <button
                onClick={commitAdjust}
                disabled={!state.adjReason || !state.adjQty}
                style={{ width: '100%', border: 0, background: state.adjReason && state.adjQty ? 'var(--green)' : 'var(--border-strong)', color: '#fff', padding: 15, borderRadius: 11, fontSize: 15.5, fontWeight: 600, minHeight: 52, marginTop: 10 }}
              >
                {state.adjType === 'return' ? 'บันทึกรับคืน' : 'บันทึกปรับยอด'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
