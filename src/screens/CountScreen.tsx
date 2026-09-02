import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { nf } from '../utils/format';

export default function CountScreen() {
  const { state, setCountInput, commitCount } = useApp();
  const [q, setQ] = useState('');
  const meds = state.meds
    .filter((m) => m.active && (!q.trim() || m.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0))
    .slice(0, 150);

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 13 }}>
        ฟังก์ชันเสริม — ใช้เมื่อสงสัยว่ายอดคลาดเคลื่อนมาก หรือเมื่อมีกำลังคนพอ ไม่จำเป็นต้องทำเป็นประจำ ("นำเข้า HOSxP" ในเมนูหลักเป็นวิธีหลักที่ใช้เวลาน้อยกว่า) นับของจริงแล้วกรอก ระบบจะแก้ยอดให้ตรงและบันทึกส่วนต่างลง discrepancy log ให้อัตโนมัติ
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ค้นหาชื่อยา"
        style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44, marginBottom: 12 }}
      />
      <div className="card stagger" style={{ overflow: 'hidden' }}>
        {meds.map((m) => {
          const typed = state.countInputs[m.id] ?? '';
          const q = parseInt(typed, 10);
          const has = typed !== '' && !isNaN(q);
          const delta = has ? q - m.floor : 0;
          const daysSince = Math.floor((Date.now() - m.lastCountTs) / 86400000);
          return (
            <div key={m.id} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>ระบบคำนวณ {nf(m.floor)} {m.unit} · นับล่าสุด {daysSince <= 0 ? 'วันนี้' : daysSince + ' วันก่อน'}</div>
                  {has && delta !== 0 && (
                    <div style={{ fontSize: 11.5, marginTop: 2, fontWeight: 600, color: delta < 0 ? 'var(--red)' : 'var(--amber)' }}>
                      {delta < 0 ? 'น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' (คาดว่าจ่ายผ่าน HOSxP)' : 'มากกว่าระบบ ' + nf(delta) + ' ' + m.unit}
                    </div>
                  )}
                </div>
                <input
                  value={typed}
                  onChange={(e) => setCountInput(m.id, e.target.value)}
                  inputMode="numeric"
                  placeholder="นับได้"
                  style={{ width: 78, flex: 'none', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 6px', fontSize: 14, fontWeight: 600, textAlign: 'center', minHeight: 42 }}
                />
                <button
                  disabled={!has}
                  onClick={() => commitCount(m.id)}
                  style={{ flex: 'none', border: 0, background: has ? 'var(--green)' : 'var(--border-strong)', color: '#fff', padding: '9px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 42 }}
                >
                  บันทึก
                </button>
              </div>
            </div>
          );
        })}
        {meds.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>ไม่พบยาที่ค้นหา</div>}
      </div>
    </div>
  );
}
