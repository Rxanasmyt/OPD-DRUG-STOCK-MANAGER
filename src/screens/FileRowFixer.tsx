// A HOSxP-file row that matched no drug (or several) is NOT a dead end: this shows which app drugs it
// could be and exactly which words/strength differ, and lets the pharmacist decide — map it (optionally
// remembering the spelling for next time), search for the drug themself, or explicitly skip it. Nothing
// is guessed: a non-"safe" suggestion needs an extra confirmation, and a skipped row is a recorded choice.
import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { suggestMedsForFileName, tokenizeMedName, inactiveMatchesFor } from '../store/selectors';
import type { Med } from '../types';
import { Badge } from '../components/Badge';

export function FileRowFixer({ idx, fileText, qty, skipped, onSkip }: {
  idx: number; fileText: string; qty: number; skipped: boolean; onSkip: (skip: boolean) => void;
}) {
  const { state, resolveHosxpRow, promptAsync } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = state.role === 'admin';
  const sugg = useMemo(() => suggestMedsForFileName(state.meds, fileText, 3), [state.meds, fileText]);
  const inactive = useMemo(() => inactiveMatchesFor(state.meds, fileText), [state.meds, fileText]);
  const results = useMemo(() => {
    const terms = tokenizeMedName(q).words.concat(tokenizeMedName(q).numbers);
    if (!q.trim() || !terms.length) return [] as Med[];
    return state.meds.filter((m) => {
      if (!m.active) return false;
      const n = m.name.toLowerCase();
      return terms.every((t) => n.includes(t));
    }).slice(0, 6);
  }, [q, state.meds]);

  const map = async (med: Med, safe: boolean) => {
    if (!safe) {
      const ok = await promptAsync('ยืนยันว่า "' + fileText + '" ในไฟล์ คือ "' + med.name + '" (ชื่อไม่ตรงทุกคำ ระบบไม่แน่ใจ) — พิมพ์ "ยืนยัน" เพื่อจับคู่');
      if (ok?.trim() !== 'ยืนยัน') return;
    }
    setBusy(true);
    await resolveHosxpRow(idx, med.id, true);
    setBusy(false);
  };

  if (skipped) {
    return (
      <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--amber-ink)', fontWeight: 600 }}>
        รับทราบ: ข้ามรายการนี้ ({qty.toLocaleString()} หน่วยจะไม่ถูกตัดยอด)
        <button type="button" onClick={() => onSkip(false)} style={linkBtn}> ยกเลิก</button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6, border: '1px dashed var(--red)', borderRadius: 9, padding: '8px 10px' }} data-testid="file-row-fixer">
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>
        จับคู่ไม่ได้ — {qty.toLocaleString()} หน่วยนี้จะไม่ถูกตัดยอด จนกว่าจะเลือกทางใดทางหนึ่ง:
      </div>
      {inactive.length > 0 && (
        <div data-testid="inactive-hint" style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 6, padding: '6px 8px', borderRadius: 8, background: 'var(--amber-bg)', color: 'var(--amber-ink)' }}>
          <b>ยานี้มีในแอพ แต่ “ปิดใช้งาน” อยู่:</b> {inactive.map((m) => m.name).join(' / ')}<br />
          ถ้าเลิกใช้จริง → กด “ข้าม” (ไม่ตัดยอด) · ถ้ายังใช้อยู่ → Admin เปิดใช้งานที่หน้าจัดการรายการยา แล้วแนบไฟล์ใหม่ (ระบบไม่ตัดยอดยาที่ปิดใช้งานให้เอง)
        </div>
      )}
      {sugg.length === 0 && inactive.length === 0 && <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 4 }}>ไม่มียาในแอพที่ชื่อคล้ายกับ "{fileText}" — อาจเป็นยาที่ยังไม่ได้ลงทะเบียนในแอพ (เพิ่มได้ที่หน้าจัดการรายการยา) หรือค้นหาด้วยตัวเองด้านล่าง</div>}
      {sugg.map(({ med, diff }) => (
        <div key={med.id} style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 6, marginTop: 6 }}>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}><span className="muted">ในแอพ: </span><b>{med.name}</b> <span className="muted">(คล้าย {Math.round(diff.score * 100)}%)</span></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
            {diff.onlyInApp.length > 0 && <Badge flexNone size={10.5} padding="2px 7px" color="var(--amber-ink)" bg="var(--amber-bg)">แอพมีแต่: {diff.onlyInApp.join(', ')}</Badge>}
            {diff.onlyInFile.length > 0 && <Badge flexNone size={10.5} padding="2px 7px" color="var(--amber-ink)" bg="var(--amber-bg)">ไฟล์มีแต่: {diff.onlyInFile.join(', ')}</Badge>}
            {diff.numbers === 'differs' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--red)" bg="var(--red-bg)">ความแรงต่าง: แอพ {diff.appNumbers.join('/')} · ไฟล์ {diff.fileNumbers.join('/')}</Badge>}
            {diff.numbers === 'equal' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--green)" bg="var(--green-tint)">ความแรงตรงกัน</Badge>}
          </div>
          <button type="button" disabled={busy} onClick={() => void map(med, diff.safe)} className="btn-primary" style={{ marginTop: 5, minHeight: 40, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
            {diff.safe ? 'ใช่ — จับคู่ยานี้' : 'ตรวจแล้ว ใช่ยาตัวนี้ (ต้องยืนยันซ้ำ)'}{isAdmin ? ' และจำชื่อนี้ไว้' : ''}
          </button>
        </div>
      ))}
      <div style={{ marginTop: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหายาในแอพเอง เช่น amlodipine 10" aria-label="ค้นหายาเพื่อจับคู่" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px', fontSize: 16, minHeight: 40 }} />
        {results.map((m) => (
          <button key={m.id} type="button" disabled={busy} onClick={() => void map(m, false)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '8px 10px', marginTop: 5, fontSize: 12.5, minHeight: 40 }}>
            {m.name}
          </button>
        ))}
      </div>
      {!isAdmin && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>จับคู่ได้เฉพาะรอบนี้ — ให้ Admin เพิ่ม "{fileText}" เป็นชื่อ HOSxP ของยา เพื่อให้ตัดอัตโนมัติครั้งต่อไป</div>}
      <button type="button" onClick={() => onSkip(true)} style={{ ...linkBtn, marginTop: 8, color: 'var(--muted)' }}>ไม่ใช่ยาของหน่วยนี้ / ไม่ต้องตัดรายการนี้ — ข้าม</button>
    </div>
  );
}

const linkBtn = { fontSize: 11.5, fontWeight: 600, color: 'var(--green)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' } as const;
