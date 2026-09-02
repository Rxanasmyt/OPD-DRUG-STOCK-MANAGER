import { useApp } from '../store/AppContext';
import { wardOf, wardLabel, toneFor } from '../store/selectors';
import { nf, digitsOnly } from '../utils/format';
import { MedDot } from '../components/MedDot';
import { Qty } from '../components/Qty';
import type { Med } from '../types';

const inputStyle = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };

/** For the case that prompted this screen: a drawer of injectables kept locked in the IPD
 * room, with a subset physically moved to an OPD stat drawer for frequent OPD codes/urgent
 * use. Since the OPD and IPD copy of a drug are separate med records (own QR/bin/par — see
 * MedsScreen), "moving" stock between them is neither a receive (nothing new entered the
 * hospital) nor a substock transfer — just one med's shelf count going down and another's
 * going up, in lockstep, with a reason on record. Works for any two active meds, not just
 * ward pairs — whatever shelf-to-shelf move actually happens in practice. */
export default function WardMoveScreen() {
  const {
    state, setWmFromSearch, pickWmFromMed, setWmToSearch, pickWmToMed, setWmQty, setWmReason, commitWardMove,
  } = useApp();
  const meds = state.meds.filter((m) => m.active);
  const fromMed = state.wmFromMed ? meds.find((m) => m.id === state.wmFromMed) : null;
  const toMed = state.wmToMed ? meds.find((m) => m.id === state.wmToMed) : null;
  const fromOptions = !state.wmFromMed && state.wmFromSearch.trim()
    ? meds.filter((m) => m.name.toLowerCase().indexOf(state.wmFromSearch.trim().toLowerCase()) >= 0).slice(0, 8)
    : [];
  const toOptions = !state.wmToMed && state.wmToSearch.trim()
    ? meds.filter((m) => m.id !== fromMed?.id && m.name.toLowerCase().indexOf(state.wmToSearch.trim().toLowerCase()) >= 0).slice(0, 8)
    : [];
  const qty = parseInt(state.wmQty, 10) || 0;
  const canSubmit = !!fromMed && !!toMed && fromMed.id !== toMed.id && qty > 0 && qty <= fromMed.floor && state.wmReason.trim();

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
        ใช้ตอนโยกยาจริงระหว่างชั้นวางสองจุด — เช่น แบ่งยาฉีดจากลิ้นชักล็อกยาฉีด IPD มาวางที่ลิ้นชักฉีดยา stat หน้างาน OPD
        ไม่ใช่การรับยาใหม่และไม่กระทบ substock — แค่ลดยอดหน้างานฝั่งต้นทาง เพิ่มยอดหน้างานฝั่งปลายทางเท่ากัน พร้อมเหตุผลบันทึกไว้
      </div>

      <PickerCard
        label="ต้นทาง (ยอดจะลด)"
        med={fromMed}
        search={state.wmFromSearch}
        onSearch={setWmFromSearch}
        options={fromOptions}
        onPick={pickWmFromMed}
      />

      <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0 10px' }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--green-tint)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, transform: 'rotate(90deg)' }}>→</div>
      </div>

      <PickerCard
        label="ปลายทาง (ยอดจะเพิ่ม)"
        med={toMed}
        search={state.wmToSearch}
        onSearch={setWmToSearch}
        options={toOptions}
        onPick={pickWmToMed}
      />

      {fromMed && toMed && (
        <div className="card" style={{ padding: 12, marginTop: 13, animation: 'fade .18s var(--ease-out)' }}>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>จำนวนที่ย้าย ({fromMed.unit}) — ต้นทางมี {nf(fromMed.floor)} {fromMed.unit}</span>
            <input value={state.wmQty} onChange={(e) => setWmQty(digitsOnly(e.target.value))} inputMode="numeric" style={{ ...inputStyle, fontSize: 17, fontWeight: 600 }} />
          </label>
          {qty > fromMed.floor && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: -6, marginBottom: 10 }}>ต้นทางมีไม่พอ — เหลือ {nf(fromMed.floor)} {fromMed.unit}</div>}
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>เหตุผล (บังคับ)</span>
            <input value={state.wmReason} onChange={(e) => setWmReason(e.target.value)} placeholder="เช่น เติม stat drawer OPD ประจำสัปดาห์" style={inputStyle} />
          </label>
          <button
            onClick={commitWardMove}
            disabled={!canSubmit}
            style={{ width: '100%', border: 0, background: canSubmit ? 'var(--green)' : 'var(--border-strong)', color: '#fff', padding: 15, borderRadius: 11, fontSize: 15, fontWeight: 600, minHeight: 52 }}
          >
            ย้าย {qty > 0 ? nf(qty) + ' ' + fromMed.unit : ''} จาก {fromMed.name} → {toMed.name}
          </button>
        </div>
      )}
    </div>
  );
}

function PickerCard({ label, med, search, onSearch, options, onPick }: {
  label: string;
  med: Med | null | undefined;
  search: string;
  onSearch: (v: string) => void;
  options: Med[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 4 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {med ? (
        <div style={{ background: 'var(--green-tint)', borderRadius: 10, padding: '9px 11px', fontSize: 13.5, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={med.code} /> {med.name}</span>
            <span className="muted" style={{ display: 'block', fontSize: 11, fontWeight: 400, marginTop: 1 }}>
              {wardLabel(wardOf(med))} · ชั้น {med.bin || '—'} · หน้างานตอนนี้ <Qty value={med.floor} unit={med.unit} tone={toneFor(med)} size={11} />
            </span>
          </span>
          <button onClick={() => onSearch('')} style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12 }}>เปลี่ยน</button>
        </div>
      ) : (
        <>
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="ค้นหาชื่อยา" style={inputStyle} />
          {options.length > 0 && (
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 158, overflowY: 'auto', marginTop: 8 }}>
              {options.map((m) => (
                <button key={m.id} onClick={() => onPick(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 12px', minHeight: 44 }}>
                  <span style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={m.code} /> {m.name}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>ชั้น {m.bin || '—'} · หน้างาน <Qty value={m.floor} unit={m.unit} tone={toneFor(m)} size={11} /></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
