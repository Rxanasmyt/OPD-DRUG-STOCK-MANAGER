import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf, digitsOnly } from '../utils/format';
import type { Med } from '../types';

type Filter = 'active' | 'inactive' | 'all';

const inputStyle = { width: '100%', border: '1px solid var(--border)', background: '#fff', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };

interface MedFormValues {
  name: string;
  dosageForm: string;
  unit: string;
  price: string;
  had: boolean;
  bin: string;
  parSub: string;
  parFloor: string;
}

function blankForm(): MedFormValues {
  return { name: '', dosageForm: '', unit: '', price: '', had: false, bin: '', parSub: '', parFloor: '' };
}

function formFromMed(m: Med): MedFormValues {
  return {
    name: m.name, dosageForm: m.dosageForm, unit: m.unit, price: m.price ? String(m.price) : '',
    had: m.had, bin: m.bin, parSub: String(m.parSub), parFloor: String(m.parFloor),
  };
}

export default function MedsScreen() {
  const { state, sub, addMed, updateMedFull, toggleMedActive, deleteMed, setMedsFocusId, openScanSearch } = useApp();
  const canEdit = state.role !== 'tech';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // A QR scan (ดูข้อมูลยา) lands here with medsFocusId set — jump straight into that med's
  // edit panel instead of leaving the person to scroll through hundreds of rows to find it.
  useEffect(() => {
    if (!state.medsFocusId) return;
    const id = state.medsFocusId;
    setFilter('all');
    setQ('');
    setAddOpen(false);
    setEditingId(id);
    setMedsFocusId(null);
    window.setTimeout(() => rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [state.medsFocusId, setMedsFocusId]);

  const meds = state.meds
    .filter((m) => (filter === 'all' ? true : filter === 'active' ? m.active : !m.active))
    .filter((m) => !q.trim() || m.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : '#fff', color: active ? '#fff' : 'var(--ink)' });

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
            addMed({ name: v.name, dosageForm: v.dosageForm, unit: v.unit, price: parseFloat(v.price) || 0, had: v.had, bin: v.bin, parSub: parseInt(v.parSub, 10) || 0, parFloor: parseInt(v.parFloor, 10) || 0 });
            setAddOpen(false);
          }}
        />
      )}

      <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
        <button className="chip" style={chip(filter === 'active')} onClick={() => setFilter('active')}>ใช้งานอยู่</button>
        <button className="chip" style={chip(filter === 'inactive')} onClick={() => setFilter('inactive')}>ปิดใช้งาน</button>
        <button className="chip" style={chip(filter === 'all')} onClick={() => setFilter('all')}>ทั้งหมด</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อยา" style={{ ...inputStyle, marginBottom: 10 }} />

      <div className="card" style={{ overflow: 'hidden' }}>
        {meds.slice(0, 150).map((m) => {
          const stockLeft = m.floor > 0 || sub(m.id) > 0;
          const isEditing = editingId === m.id;
          return (
            <div key={m.id} ref={(el) => { rowRefs.current[m.id] = el; }} style={{ borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ padding: '11px 13px', background: isEditing ? 'var(--green-tint)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{m.name}{m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}> HAD</span>}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{m.code} · ชั้น {m.bin || '—'} · {m.unit} · {nf(m.price)} บาท</div>
                  </div>
                  <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: m.active ? 'var(--green)' : 'var(--muted)', background: m.active ? 'var(--green-tint)' : '#f2f3ee', padding: '4px 8px', borderRadius: 20 }}>{m.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button onClick={() => { setEditingId(isEditing ? null : m.id); setAddOpen(false); }} style={{ flex: 1, border: '1px solid var(--green)', background: isEditing ? 'var(--green)' : '#fff', color: isEditing ? '#fff' : 'var(--green)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                    {isEditing ? 'ปิดฟอร์มแก้ไข' : 'แก้ไขข้อมูล'}
                  </button>
                  <button onClick={() => toggleMedActive(m.id)} style={{ flex: 1, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                    {m.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                  </button>
                  <button
                    onClick={() => deleteMed(m.id)}
                    disabled={stockLeft}
                    title={stockLeft ? 'ยังมียอดคงเหลือ ต้องปรับยอดให้เป็น 0 ก่อน' : 'ลบถาวร'}
                    style={{ flex: 'none', border: '1px solid var(--border)', background: '#fff', color: stockLeft ? '#c3c7bc' : 'var(--red)', padding: '8px 11px', borderRadius: 9, fontSize: 12, minHeight: 38, whiteSpace: 'nowrap' }}
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
                      updateMedFull(m.id, { name: v.name, dosageForm: v.dosageForm, unit: v.unit, price: parseFloat(v.price) || 0, had: v.had, bin: v.bin, parSub: parseInt(v.parSub, 10) || 0, parFloor: parseInt(v.parFloor, 10) || 0 });
                      setEditingId(null);
                    }}
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
function MedForm({ heading, initial, submitLabel, onCancel, onSubmit }: {
  heading: string | null;
  initial: MedFormValues;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: MedFormValues) => void;
}) {
  const [v, setV] = useState<MedFormValues>(initial);
  const set = <K extends keyof MedFormValues>(k: K, val: MedFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : '#fff', color: active ? '#fff' : 'var(--ink)' });

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
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชั้นวาง</span>
          <input value={v.bin} onChange={(e) => set('bin', e.target.value)} placeholder="เช่น J4" style={{ ...inputStyle, textTransform: 'uppercase' as const }} />
        </label>
      </div>
      <div className="grid-2" style={{ marginBottom: 9 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par substock</span>
          <input value={v.parSub} onChange={(e) => set('parSub', digitsOnly(e.target.value))} inputMode="numeric" style={inputStyle} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par หน้างาน</span>
          <input value={v.parFloor} onChange={(e) => set('parFloor', digitsOnly(e.target.value))} inputMode="numeric" style={inputStyle} />
        </label>
      </div>
      <button onClick={() => set('had', !v.had)} className="chip" style={{ ...chip(v.had), width: '100%', marginBottom: 12, textAlign: 'center' }}>{v.had ? '✓ ยา high alert' : 'ยา high alert?'}</button>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="btn-outline" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, minHeight: 46 }}>ยกเลิก</button>
        <button onClick={() => onSubmit(v)} disabled={!v.name.trim()} className="btn-primary" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46, opacity: v.name.trim() ? 1 : 0.5 }}>{submitLabel}</button>
      </div>
    </div>
  );
}
