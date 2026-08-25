import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf, digitsOnly } from '../utils/format';

type Filter = 'active' | 'inactive' | 'all';

const inputStyle = { width: '100%', border: '1px solid var(--border)', background: '#fff', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };

export default function MedsScreen() {
  const { state, sub, addMed, toggleMedActive, deleteMed } = useApp();
  const canEdit = state.role !== 'tech';
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [formOpen, setFormOpen] = useState(false);

  const [name, setName] = useState('');
  const [dosageForm, setDosageForm] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [had, setHad] = useState(false);
  const [bin, setBin] = useState('');
  const [parSub, setParSubIn] = useState('');
  const [parFloor, setParFloorIn] = useState('');

  const meds = state.meds
    .filter((m) => (filter === 'all' ? true : filter === 'active' ? m.active : !m.active))
    .filter((m) => !q.trim() || m.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const chip = (active: boolean) => ({ border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : '#fff', color: active ? '#fff' : 'var(--ink)' });

  const resetForm = () => { setName(''); setDosageForm(''); setUnit(''); setPrice(''); setHad(false); setBin(''); setParSubIn(''); setParFloorIn(''); };

  const submit = () => {
    addMed({ name, dosageForm, unit, price: parseFloat(price) || 0, had, bin, parSub: parseInt(parSub, 10) || 0, parFloor: parseInt(parFloor, 10) || 0 });
    resetForm();
    setFormOpen(false);
  };

  if (!canEdit) {
    return (
      <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
        <div style={{ fontSize: 12.5, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px' }}>บทบาทผู้ช่วยเภสัชกรเข้าหน้านี้ไม่ได้ — การเพิ่ม/ปิดใช้งาน/ลบยาสงวนไว้สำหรับเภสัชกรและ Admin</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        เมื่อ รพ. เพิ่มยาใหม่หรือตัดยาออกจากบัญชี ให้จัดการที่นี่ — ยาที่ "ปิดใช้งาน" จะไม่ขึ้นในหน้าเติมหน้างาน/รับเข้าอีก แต่ประวัติธุรกรรมเดิมยังอยู่ครบ ส่วน "ลบถาวร" ทำได้เฉพาะยาที่ยอดคงเหลือเป็น 0 ทั้ง substock และหน้างานแล้วเท่านั้น
      </div>

      {!formOpen ? (
        <button onClick={() => setFormOpen(true)} className="btn-primary" style={{ width: '100%', padding: 13, borderRadius: 11, fontSize: 14.5, fontWeight: 600, minHeight: 48, marginBottom: 14 }}>+ เพิ่มยาใหม่</button>
      ) : (
        <div className="card" style={{ padding: 13, marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>เพิ่มยาใหม่</div>
          <label style={{ display: 'block', marginBottom: 9 }}>
            <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชื่อยา + ขนาด (เช่น Enalapril 5 mg)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </label>
          <div className="grid-2" style={{ marginBottom: 9 }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>รูปแบบยา</span>
              <input value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} placeholder="เช่น Tablet" style={inputStyle} />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>หน่วย</span>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="เช่น เม็ด" style={inputStyle} />
            </label>
          </div>
          <div className="grid-2" style={{ marginBottom: 9 }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ราคา/หน่วย (บาท)</span>
              <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={inputStyle} />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>ชั้นวาง</span>
              <input value={bin} onChange={(e) => setBin(e.target.value)} placeholder="เช่น J4" style={{ ...inputStyle, textTransform: 'uppercase' as const }} />
            </label>
          </div>
          <div className="grid-2" style={{ marginBottom: 9 }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par substock</span>
              <input value={parSub} onChange={(e) => setParSubIn(digitsOnly(e.target.value))} inputMode="numeric" style={inputStyle} />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>par หน้างาน</span>
              <input value={parFloor} onChange={(e) => setParFloorIn(digitsOnly(e.target.value))} inputMode="numeric" style={inputStyle} />
            </label>
          </div>
          <button onClick={() => setHad((v) => !v)} className="chip" style={{ ...chip(had), width: '100%', marginBottom: 12, textAlign: 'center' }}>{had ? '✓ ยา high alert' : 'ยา high alert?'}</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { resetForm(); setFormOpen(false); }} className="btn-outline" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, minHeight: 46 }}>ยกเลิก</button>
            <button onClick={submit} disabled={!name.trim()} className="btn-primary" style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46, opacity: name.trim() ? 1 : 0.5 }}>บันทึก</button>
          </div>
        </div>
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
          return (
            <div key={m.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{m.name}{m.had && <span style={{ color: 'var(--had)', fontSize: 11, fontWeight: 700 }}> HAD</span>}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{m.code} · ชั้น {m.bin || '—'} · {m.unit} · {nf(m.price)} บาท</div>
                </div>
                <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: m.active ? 'var(--green)' : 'var(--muted)', background: m.active ? 'var(--green-tint)' : '#f2f3ee', padding: '4px 8px', borderRadius: 20 }}>{m.active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</span>
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button onClick={() => toggleMedActive(m.id)} style={{ flex: 1, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)', padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 600, minHeight: 38 }}>
                  {m.active ? 'ปิดใช้งาน (ตัดออกจากบัญชี)' : 'เปิดใช้งานอีกครั้ง'}
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
          );
        })}
        {meds.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่พบยาที่ค้นหา</div>}
      </div>
      {meds.length > 150 && <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>แสดง 150 รายการแรก — ค้นหาชื่อยาเพื่อหารายการอื่น</div>}
    </div>
  );
}
