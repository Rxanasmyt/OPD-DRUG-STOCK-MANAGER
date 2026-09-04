import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf, digitsOnly } from '../utils/format';
import { wardOf, wardLabel, floorMinOf, toneFor, isSharedMed, matchesWard } from '../store/selectors';
import { MedDot } from '../components/MedDot';
import { Qty } from '../components/Qty';
import type { Med, Ward } from '../types';

type Filter = 'active' | 'inactive' | 'all';

const inputStyle = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };
const WARD_COLOR: Record<Ward, string> = { opd: 'var(--green)', ipd: 'var(--ipd)' };
const WARD_BG: Record<Ward, string> = { opd: 'var(--green-tint)', ipd: 'var(--ipd-bg)' };

interface MedFormValues {
  name: string;
  dosageForm: string;
  unit: string;
  price: string;
  had: boolean;
  bin: string;
  parSub: string;
  parFloor: string;
  floorMin: string;
  ward: Ward;
  noSubstock: boolean;
  volatility: string;
  // ยาที่ IPD หยิบตรงจากชั้น OPD (ไม่มีสต็อกแยก) — ดู isSharedMed()/Med.binIpd. เมื่อ true จะโชว์
  // ชั้นวางสองรหัส (OPD/IPD) แทนตัวเลือกหอผู้ป่วยเดี่ยว และ `bin`/`binIpd` ทั้งคู่บันทึกลงยา
  // รายการเดียวกัน — คนละกลไกกับ "รวมสต็อก" (mergeWardMeds) ที่ใช้ตอนมีสต็อกแยกสองรายการอยู่แล้ว
  shared: boolean;
  binIpd: string;
}

function blankForm(): MedFormValues {
  return { name: '', dosageForm: '', unit: '', price: '', had: false, bin: '', parSub: '', parFloor: '', floorMin: '', ward: 'opd', noSubstock: false, volatility: '1.10', shared: false, binIpd: '' };
}

function formFromMed(m: Med): MedFormValues {
  return {
    name: m.name, dosageForm: m.dosageForm, unit: m.unit, price: m.price ? String(m.price) : '',
    had: m.had, bin: m.bin, parSub: String(m.parSub), parFloor: String(m.parFloor), floorMin: String(floorMinOf(m)),
    ward: wardOf(m), noSubstock: !!m.noSubstock, volatility: m.volatility.toFixed(2),
    shared: isSharedMed(m), binIpd: m.binIpd || '',
  };
}

export default function MedsScreen() {
  const { state, sub, addMed, updateMedFull, mergeWardMeds, setMedBin, toggleMedActive, deleteMed, deleteAllInactiveMeds, setMedsFocusId, openScanSearch } = useApp();
  const canEdit = state.role !== 'tech';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [wardTab, setWardTab] = useState<'all' | Ward>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // A QR scan (ดูข้อมูลยา) lands here with medsFocusId set — jump straight into that med's
  // edit panel instead of leaving the person to scroll through hundreds of rows to find it.
  useEffect(() => {
    if (!state.medsFocusId) return;
    const id = state.medsFocusId;
    const target = state.meds.find((m) => m.id === id);
    setFilter('all');
    // Bug fix: this reset `filter` (active/inactive) but not the ward tab — scanning an IPD
    // med's QR while this screen's ward tab was still on "OPD" set editingId to a row that
    // the ward filter below was hiding, so nothing visibly happened (no edit panel, nothing
    // to scroll to) even though the scan itself worked fine.
    setWardTab('all');
    // Bug fix: this used to clear the search box instead — with a 585-item formulary and the
    // list below capped to the first 150 (alphabetically sorted) results, a scanned med whose
    // name sorts past position 150 would never actually render, so editingId pointed at a row
    // that flat-out didn't exist in the DOM: no edit panel, nothing to scroll to, same silent
    // failure as the ward-tab bug above just via a different mechanism. Narrowing the search
    // to the med's own name guarantees it's the only (or first) match, always inside the cap.
    setQ(target ? target.name : '');
    setAddOpen(false);
    setEditingId(id);
    setMedsFocusId(null);
    window.setTimeout(() => rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [state.medsFocusId, state.meds, setMedsFocusId]);

  const meds = state.meds
    .filter((m) => (filter === 'all' ? true : filter === 'active' ? m.active : !m.active))
    .filter((m) => matchesWard(m, wardTab))
    .filter((m) => !q.trim() || m.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  if (!canEdit) {
    return (
      <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
        <div style={{ fontSize: 12.5, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px' }}>บทบาทผู้ช่วยเภสัชกรเข้าหน้านี้ไม่ได้ — การเพิ่ม/แก้ไข/ปิดใช้งาน/ลบยาสงวนไว้สำหรับเภสัชกรและ Admin</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        ชื่อยา ขนาด รูปแบบยา หน่วย ราคา/หน่วย par substock/หน้างาน และชั้นวาง แก้ไขได้ในที่เดียวที่นี่ — กด "แก้ไขข้อมูล" ที่รายการ หรือสแกน QR ฉลากที่ติดหน้ายา/ชั้นวางเพื่อเปิดข้อมูลรายการนั้นโดยตรง เมื่อ รพ. เพิ่มยาใหม่หรือตัดยาออกจากบัญชี ก็จัดการที่นี่เช่นกัน — ยาที่ "ปิดใช้งาน" จะไม่ขึ้นในหน้าเติมหน้างาน/รับเข้าอีก แต่ประวัติธุรกรรมเดิมยังอยู่ครบ ส่วน "ลบถาวร" ทำได้เฉพาะยาที่ยอดคงเหลือเป็น 0 แล้วเท่านั้น
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => { setAddOpen((v) => !v); setEditingId(null); }} className="btn-primary" style={{ flex: 1, padding: 13, borderRadius: 11, fontSize: 14, fontWeight: 600, minHeight: 48 }}>+ เพิ่มยาใหม่</button>
        <button onClick={() => openScanSearch('viewMed')} className="btn-outline" style={{ flex: 'none', padding: '13px 16px', borderRadius: 11, fontSize: 17, minHeight: 48 }} title="สแกน QR ดูข้อมูลยา">▣</button>
      </div>

      {addOpen && (
        <MedForm
          heading="เพิ่มยาใหม่"
          initial={blankForm()}
          submitLabel="บันทึก"
          onCancel={() => setAddOpen(false)}
          onSubmit={(v) => {
            addMed({ name: v.name, dosageForm: v.dosageForm, unit: v.unit, price: parseFloat(v.price) || 0, had: v.had, bin: v.bin, parSub: parseInt(v.parSub, 10) || 0, parFloor: parseInt(v.parFloor, 10) || 0, floorMin: parseInt(v.floorMin, 10) || 0, ward: v.shared ? 'opd' : v.ward, noSubstock: v.noSubstock, volatility: parseFloat(v.volatility) || 1.1, binIpd: v.shared ? v.binIpd : undefined });
            setAddOpen(false);
          }}
        />
      )}

      <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
        <button className="chip" style={{ ...chip(wardTab === 'all'), flex: 1, textAlign: 'center' }} onClick={() => setWardTab('all')}>ทุกหอผู้ป่วย</button>
        <button className="chip" style={{ ...chip(wardTab === 'opd'), flex: 1, textAlign: 'center', ...(wardTab === 'opd' ? { background: WARD_COLOR.opd, borderColor: WARD_COLOR.opd } : {}) }} onClick={() => setWardTab('opd')}>OPD</button>
        <button className="chip" style={{ ...chip(wardTab === 'ipd'), flex: 1, textAlign: 'center', ...(wardTab === 'ipd' ? { background: WARD_COLOR.ipd, borderColor: WARD_COLOR.ipd } : {}) }} onClick={() => setWardTab('ipd')}>IPD</button>
      </div>
      <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
        <button className="chip" style={chip(filter === 'active')} onClick={() => setFilter('active')}>ใช้งานอยู่</button>
        <button className="chip" style={chip(filter === 'inactive')} onClick={() => setFilter('inactive')}>ปิดใช้งาน</button>
        <button className="chip" style={chip(filter === 'all')} onClick={() => setFilter('all')}>ทั้งหมด</button>
      </div>

      {filter === 'inactive' && meds.length > 0 && (
        <button
          onClick={() => deleteAllInactiveMeds(meds.map((m) => m.id))}
          style={{ width: '100%', border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', padding: '11px 14px', borderRadius: 11, fontSize: 13, fontWeight: 600, minHeight: 46, marginBottom: 10 }}
        >
          ลบยาที่ปิดใช้งานและยอดเป็น 0 ทั้งหมดออกจากระบบถาวร ({meds.length} รายการ)
        </button>
      )}

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อยา" style={{ ...inputStyle, marginBottom: 10 }} />

      <div className="card stagger" style={{ overflow: 'hidden' }}>
        {meds.slice(0, 150).map((m) => {
          const stockLeft = m.floor > 0 || sub(m.id) > 0;
          const isEditing = editingId === m.id;
          return (
            <div key={m.id} ref={(el) => { rowRefs.current[m.id] = el; }} style={{ borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ padding: '11px 13px', background: isEditing ? 'var(--green-tint)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <MedDot code={m.code} />
                      <span>{m.name}</span>
                      {m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}>HAD</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {m.code} · ชั้น {isSharedMed(m) ? ('OPD ' + (m.bin || '—') + ' / IPD ' + (m.binIpd || '—')) : (m.bin || '—')} · {m.unit} · {nf(m.price)} บาท
                    </div>
                    {m.active && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        หน้างาน <Qty value={m.floor} tone={toneFor(m)} size={11} /> · substock {nf(sub(m.id))} {m.unit}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                      {isSharedMed(m) ? (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', background: 'var(--green-tint)', padding: '2px 7px', borderRadius: 20 }}>OPD+IPD ร่วมกัน</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, color: WARD_COLOR[wardOf(m)], background: WARD_BG[wardOf(m)], padding: '2px 7px', borderRadius: 20 }}>{wardOf(m) === 'opd' ? 'OPD' : 'IPD'}</span>
                      )}
                      {m.noSubstock && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber-ink)', background: 'var(--amber-bg)', padding: '2px 7px', borderRadius: 20 }}>ไม่มี substock</span>}
                    </div>
                  </div>
                  <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: m.active ? 'var(--green)' : 'var(--muted)', background: m.active ? 'var(--green-tint)' : 'var(--bg-subtle)', padding: '4px 8px', borderRadius: 20 }}>{m.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button onClick={() => { setEditingId(isEditing ? null : m.id); setAddOpen(false); }} style={{ flex: 1, border: '1px solid var(--green)', background: isEditing ? 'var(--green)' : 'var(--bg-card)', color: isEditing ? '#fff' : 'var(--green)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                    {isEditing ? 'ปิดฟอร์มแก้ไข' : 'แก้ไขข้อมูล'}
                  </button>
                  <button onClick={() => toggleMedActive(m.id)} style={{ flex: 1, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                    {m.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  </button>
                  <button
                    onClick={() => deleteMed(m.id)}
                    disabled={stockLeft}
                    title={stockLeft ? 'ยังมียอดคงเหลือ ต้องปรับยอดให้เป็น 0 ก่อน' : 'ลบถาวร'}
                    style={{ flex: 'none', border: '1px solid var(--border)', background: 'var(--bg-card)', color: stockLeft ? 'var(--muted)' : 'var(--red)', padding: '8px 11px', borderRadius: 9, fontSize: 12, minHeight: 38, whiteSpace: 'nowrap' }}
                  >
                    ลบถาวร
                  </button>
                </div>
              </div>
              {isEditing && (
                <div style={{ padding: '0 13px 14px' }}>
                  <MedForm
                    heading={null}
                    initial={formFromMed(m)}
                    submitLabel="บันทึกการแก้ไข"
                    onCancel={() => setEditingId(null)}
                    onSubmit={(v) => {
                      updateMedFull(m.id, { name: v.name, dosageForm: v.dosageForm, unit: v.unit, price: parseFloat(v.price) || 0, had: v.had, bin: v.bin, parSub: parseInt(v.parSub, 10) || 0, parFloor: parseInt(v.parFloor, 10) || 0, floorMin: parseInt(v.floorMin, 10) || 0, ward: v.shared ? 'opd' : v.ward, noSubstock: v.noSubstock, volatility: parseFloat(v.volatility) || 1.1, binIpd: v.shared ? v.binIpd : undefined });
                      setEditingId(null);
                    }}
                    // ยาชื่อเดียวกันที่แยกรายการไว้คนละ ward (คนละ Firestore doc ตามหลักการออกแบบ
                    // เดิม) มักมีชั้นวางคนละที่ ให้แก้ชั้นวางของอีกฝั่งได้จากฟอร์มนี้เลยเพื่อความ
                    // สะดวก โดยยังเป็นคนละ field ที่บันทึกแยก (setMedBin เขียนทันทีแบบ debounce
                    // เหมือนช่องอื่นๆ) — ใช้ได้เฉพาะยาที่ "ยังไม่รวมสต็อก" เท่านั้น (ถ้ารวมแล้ว
                    // isSharedMed(m) เป็น true ฟอร์มจะโชว์ชั้นวางสองรหัสของ record เดียวแทน ไม่ต้อง
                    // หา sibling อีก — และ record คู่เดิมที่ปิดใช้งานไปหลังรวม ก็ไม่ควรโผล่มาให้แก้)
                    sibling={isSharedMed(m) ? undefined : state.meds.find((x) => x.id !== m.id && x.active && x.name === m.name && wardOf(x) !== wardOf(m))}
                    onSiblingBinChange={(siblingId, val) => setMedBin(siblingId, val)}
                    onMerge={(siblingId) => mergeWardMeds(m.id, siblingId)}
                  />
                </div>
              )}
            </div>
          );
        })}
        {meds.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่พบยาที่ค้นหา</div>}
      </div>
      {meds.length > 150 && <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>แสดง 150 รายการแรก — ค้นหาชื่อยาเพื่อหารายการอื่น</div>}
    </div>
  );
}

/** The one place every editable fact about a med lives — name+strength, dosage form, unit,
 * price, high-alert flag, shelf/bin, and both par levels — used both for "เพิ่มยาใหม่" (blank)
 * and a row's "แก้ไขข้อมูล" (pre-filled), so there's exactly one form to keep in sync. */
function MedForm({ heading, initial, submitLabel, onCancel, onSubmit, sibling, onSiblingBinChange, onMerge }: {
  heading: string | null;
  initial: MedFormValues;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: MedFormValues) => void;
  /** The same drug's other-ward record (same name, opposite ward), if one exists — lets its
   * shelf code be edited right here instead of having to search it up as a separate row. */
  sibling?: Med;
  onSiblingBinChange?: (siblingId: string, val: string) => void;
  /** Folds `sibling`'s real stock into this med as one pooled OPD/IPD record — see
   * mergeWardMeds() in AppContext.tsx. Only offered when a sibling exists. */
  onMerge?: (siblingId: string) => void;
}) {
  const [v, setV] = useState<MedFormValues>(initial);
  const set = <K extends keyof MedFormValues>(k: K, val: MedFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const setShared = (on: boolean) => setV((s) => ({ ...s, shared: on, binIpd: on ? s.binIpd : '' }));
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)' });

  return (
    <div className="card" style={{ padding: 13, marginBottom: 14, animation: 'fade .16s var(--ease-out)' }}>
      {heading && <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>{heading}</div>}
      <label style={{ display: 'block', marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชื่อยา + ขนาด (เช่น Enalapril 5 mg)</span>
        <input value={v.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
      </label>
      <div className="grid-2" style={{ marginBottom: 9 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>รูปแบบยา</span>
          <input value={v.dosageForm} onChange={(e) => set('dosageForm', e.target.value)} placeholder="เช่น Tablet" style={inputStyle} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>หน่วย</span>
          <input value={v.unit} onChange={(e) => set('unit', e.target.value)} placeholder="เช่น เม็ด" style={inputStyle} />
        </label>
      </div>
      <div className="grid-2" style={{ marginBottom: 9 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ราคา/หน่วย (บาท)</span>
          <input value={v.price} onChange={(e) => set('price', e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={inputStyle} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{v.shared ? 'ชั้นวาง (OPD)' : 'ชั้นวาง'}</span>
          <input value={v.bin} onChange={(e) => set('bin', e.target.value)} placeholder="เช่น J4" style={{ ...inputStyle, textTransform: 'uppercase' as const }} />
        </label>
      </div>
      {v.shared ? (
        <div style={{ marginBottom: 9 }}>
          <label style={{ display: 'block', marginBottom: 7 }}>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชั้นวาง (IPD)</span>
            <input value={v.binIpd} onChange={(e) => set('binIpd', e.target.value)} placeholder="เช่น J4" style={{ ...inputStyle, textTransform: 'uppercase' as const, borderColor: WARD_COLOR.ipd }} />
          </label>
          <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--green)', background: 'var(--green-tint)', borderRadius: 9, padding: '8px 10px' }}>
            ใช้สต็อกร่วมกันทั้ง OPD และ IPD — หน้างาน/par/substock เป็นยอดเดียวกันหมด ต่างกันแค่รหัสชั้นวางที่แสดงตามฝั่งที่ดู (IPD หยิบยาจากชั้น OPD ตรง ๆ)
            {!sibling && <button type="button" onClick={() => setShared(false)} style={{ display: 'block', marginTop: 6, border: 0, background: 'transparent', color: 'var(--green)', fontWeight: 600, fontSize: 11, textDecoration: 'underline', padding: 0 }}>เลิกใช้ร่วมกัน (แยกเป็นคนละ ward)</button>}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 9 }}>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>หอผู้ป่วยที่ใช้ชั้นวางนี้</span>
          <div style={{ display: 'flex', gap: 7 }}>
            <button onClick={() => set('ward', 'opd')} style={{ flex: 1, border: v.ward === 'opd' ? '1px solid ' + WARD_COLOR.opd : '1px solid var(--border)', background: v.ward === 'opd' ? WARD_BG.opd : 'var(--bg-card)', color: v.ward === 'opd' ? WARD_COLOR.opd : 'var(--ink)', padding: '10px 4px', borderRadius: 9, fontSize: 13, fontWeight: 600, minHeight: 42 }}>ผู้ป่วยนอก (OPD)</button>
            <button onClick={() => set('ward', 'ipd')} style={{ flex: 1, border: v.ward === 'ipd' ? '1px solid ' + WARD_COLOR.ipd : '1px solid var(--border)', background: v.ward === 'ipd' ? WARD_BG.ipd : 'var(--bg-card)', color: v.ward === 'ipd' ? WARD_COLOR.ipd : 'var(--ink)', padding: '10px 4px', borderRadius: 9, fontSize: 13, fontWeight: 600, minHeight: 42 }}>ผู้ป่วยใน (IPD)</button>
          </div>
          <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 5 }}>ยาที่ IPD จัด one-day dose โดยหยิบจากชั้น OPD ตรง ๆ (สต็อกก้อนเดียวกัน ต่างแค่ชั้นวาง) ให้ใช้ "ใช้ยอดร่วมกัน" ด้านล่างแทนการแยกเป็นคนละรายการ — แยกเป็นคนละ ward จริง ๆ ไว้สำหรับยาที่มีสต็อกแยกต่างหาก เช่น ยาฉีดในลิ้นชักล็อก IPD ที่แบ่งมาวาง stat ที่ OPD (ใช้ "ย้ายยาระหว่างชั้นวาง" ตอนโยกของจริง)</div>
          {!sibling && (
            <button type="button" onClick={() => setShared(true)} style={{ width: '100%', marginTop: 8, border: '1px dashed var(--green)', background: 'transparent', color: 'var(--green)', padding: '8px 10px', borderRadius: 9, fontSize: 12, fontWeight: 600 }}>
              + ใช้ยอดร่วมกันทั้ง OPD และ IPD (คนละชั้นวาง ยอดเดียวกัน)
            </button>
          )}
        </div>
      )}
      {sibling && onSiblingBinChange && (
        <div className="card" style={{ padding: 11, marginBottom: 9, background: 'var(--bg-subtle)' }}>
          <label style={{ display: 'block', marginBottom: onMerge ? 9 : 0 }}>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              ชั้นวาง ({wardOf(sibling) === 'opd' ? 'OPD' : 'IPD'}) — อีกรายการของยานี้ (แยกสต็อกกันอยู่)
            </span>
            <input
              value={sibling.bin}
              onChange={(e) => onSiblingBinChange(sibling.id, e.target.value)}
              placeholder="เช่น J4"
              style={{ ...inputStyle, textTransform: 'uppercase' as const, borderColor: WARD_COLOR[wardOf(sibling)] }}
            />
            <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 5 }}>
              บันทึกทันทีแยกจากฟอร์มนี้ (คนละรายการยาใน DB) — แก้แค่ชั้นวาง ไม่รวมสต็อก
            </div>
          </label>
          {onMerge && (
            <button
              type="button"
              onClick={() => onMerge(sibling.id)}
              style={{ width: '100%', border: 0, background: 'var(--green)', color: '#fff', padding: '10px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600 }}
            >
              รวมสต็อก OPD+IPD เป็นยอดเดียวกัน (มีถามยืนยันอีกครั้ง)
            </button>
          )}
        </div>
      )}
      <div className="grid-2" style={{ marginBottom: 9 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par substock</span>
          <input value={v.parSub} onChange={(e) => set('parSub', digitsOnly(e.target.value))} inputMode="numeric" disabled={v.noSubstock} style={{ ...inputStyle, ...(v.noSubstock ? { background: 'var(--bg-subtle)', color: 'var(--muted)' } : {}) }} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par หน้างาน (Max — เติมขึ้นถึงจุดนี้)</span>
          <input value={v.parFloor} onChange={(e) => set('parFloor', digitsOnly(e.target.value))} inputMode="numeric" style={inputStyle} />
        </label>
      </div>
      <label style={{ display: 'block', marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>จุดต่ำสุดต้องเติม (Min)</span>
        <input value={v.floorMin} onChange={(e) => set('floorMin', digitsOnly(e.target.value))} placeholder={'ว่างไว้ = ' + nf(floorMinOf({ parFloor: parseInt(v.parFloor, 10) || 0 } as Med)) + ' (30% ของ Max ปัดเป็นเลขลงตัว)'} inputMode="numeric" style={inputStyle} />
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>ต่ำกว่าจุดนี้คือของจริงที่ต้องเติมตอนเช้า — คนละจุดกับ Max เพราะอัตราการใช้ OPD/IPD ไม่เท่ากัน แม้ยารหัสเดียวกันก็ตั้ง Min-Max ต่างกันได้ตามชั้นวางจริง</div>
      </label>
      <label style={{ display: 'block', marginBottom: 9 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ตัวคูณกันชน (volatility) — ใช้ตอนคำนวณ "ค่าแนะนำ"</span>
        <input
          value={v.volatility}
          onChange={(e) => set('volatility', e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          style={inputStyle}
        />
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>
          เวลากด "ใช้ค่าแนะนำ" ระบบคำนวณ Max = (การใช้เฉลี่ยต่อวัน) × (จำนวนวันสำรอง) × <b>ตัวเลขนี้</b> — ยิ่งสูง ยิ่งเผื่อของมากขึ้นสำหรับยาที่การใช้ไม่แน่นอน (ปกติ 1.00–1.40, ต่ำสุด 1.00 = ไม่เผื่อเลย)
        </div>
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => set('had', !v.had)} className="chip" style={{ ...chip(v.had), flex: 1, textAlign: 'center' }}>{v.had ? '✓ ยา high alert' : 'ยา high alert?'}</button>
        <button onClick={() => set('noSubstock', !v.noSubstock)} className="chip" style={{ ...chip(v.noSubstock), flex: 1, textAlign: 'center' }}>{v.noSubstock ? '✓ ไม่มี substock' : 'ไม่มี substock?'}</button>
      </div>
      {v.noSubstock && (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 9, padding: '8px 10px', marginTop: -6, marginBottom: 12 }}>
          เช่น ยาน้ำ/ยาพ่น — รับยาเข้าแล้วขึ้นหน้างานทันที ไม่ต้องเติมจาก substock อีกขั้น (par substock ปิดใช้งานให้อัตโนมัติ)
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, minHeight: 46 }}>ยกเลิก</button>
        <button onClick={() => onSubmit(v)} disabled={!v.name.trim()} className="btn-primary" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46, opacity: v.name.trim() ? 1 : 0.5 }}>{submitLabel}</button>
      </div>
    </div>
  );
}
