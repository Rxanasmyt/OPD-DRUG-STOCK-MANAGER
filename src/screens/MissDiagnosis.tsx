// "ทำไมยาตัวนี้ไม่ถูกตัดยอด" — analysis, not just a label. Compares the med's name against the file
// names that matched nothing and says either (a) here is the file name that looks like this drug
// and exactly which words/strength differ, with a one-tap alias button, or (b) nothing resembles
// it, so it was most likely not dispensed that day (with how often it normally is).
import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { diagnoseMiss, BUSINESS_DAYS_30, type MissVerdict } from '../store/selectors';
import type { Med } from '../types';
import { Badge } from '../components/Badge';

const VERDICT_UI: Record<MissVerdict, { badge: string; color: string; bg: string }> = {
  rename_candidate: { badge: 'ชื่อต่างกัน — น่าจะเป็นยาเดียวกัน', color: 'var(--red)', bg: 'var(--red-bg)' },
  needs_review: { badge: 'ชื่อคล้าย — ต้องให้เภสัชกรยืนยัน', color: 'var(--amber-ink)', bg: 'var(--amber-bg)' },
  strength_mismatch: { badge: 'ความแรงไม่ตรง', color: 'var(--red)', bg: 'var(--red-bg)' },
  suspicious: { badge: 'น่าสงสัย — ควรตรวจไฟล์', color: 'var(--amber-ink)', bg: 'var(--amber-bg)' },
  likely_no_dispense: { badge: 'น่าจะไม่มีการจ่ายวันนั้น', color: 'var(--green)', bg: 'var(--green-tint)' },
};

export function MissDiagnosis({ med, fileNames, onFixMed }: {
  med: Med;
  /** file names that matched no med on that day / recently. Empty = the app has no record of them. */
  fileNames: readonly string[];
  onFixMed: (id: Med['id']) => void;
}) {
  const { state, addHosxpAlias } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  // After an alias is added the file name resolves to this med, so re-running the analysis would
  // flip to "probably not dispensed" — misleading. Show the outcome instead.
  const [addedName, setAddedName] = useState<string | null>(null);

  if (addedName) {
    return (
      <div role="status" style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.55, color: 'var(--green)', fontWeight: 600 }}>
        ✓ เพิ่มชื่อ "{addedName}" ให้ยานี้แล้ว — ไฟล์ HOSxP ครั้งถัดไปจะตัดยอดได้ (ยอดของวันที่ผ่านมาแล้วต้องปรับด้วยมือ)
      </div>
    );
  }
  if (!fileNames.length) {
    return (
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
        ไม่มีบันทึกรายชื่อที่จับคู่ไม่ได้ของไฟล์วันนี้ จึงวิเคราะห์ไม่ได้ว่าเป็นเพราะชื่อไม่ตรงหรือวันนั้นไม่มีการจ่าย —
        ถ้าสงสัย ให้เปิดไฟล์ HOSxP ของวันนั้นแล้วค้นหาชื่อยานี้ (หรือชื่อสามัญ) ถ้าพบ แปลว่าชื่อไม่ตรง
        <button type="button" onClick={() => onFixMed(med.id)} style={{ ...linkBtn, display: 'block', marginTop: 4 }}>แก้ไขชื่อยา/เพิ่มชื่อ HOSxP ที่รู้จัก →</button>
      </div>
    );
  }
  const d = diagnoseMiss(med, fileNames, state.meds);
  const ui = VERDICT_UI[d.verdict];
  const freq = d.dispenseDays30 !== null ? `ปกติยานี้จ่าย ${d.dispenseDays30} วัน จาก ~${BUSINESS_DAYS_30} วันทำการใน 30 วัน — วันที่ไม่มีจ่ายเป็นเรื่องปกติราว ${Math.max(0, Math.round((1 - Math.min(1, d.dispenseDays30 / BUSINESS_DAYS_30)) * 100))}% ของวัน` : null;

  const add = async (fileName: string) => {
    setBusy(fileName);
    const ok = await addHosxpAlias(med.id, fileName);
    setBusy(null);
    if (ok) { setDone((s) => new Set(s).add(fileName)); setAddedName(fileName); }
  };

  return (
    <div style={{ marginTop: 6 }} data-testid="miss-diagnosis" data-verdict={d.verdict}>
      <Badge flexNone size={10.5} padding="2px 8px" color={ui.color} bg={ui.bg}>{ui.badge}</Badge>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>
        {d.verdict === 'rename_candidate' && 'พบชื่อในไฟล์ที่ตรงกับชื่อยานี้ทุกคำ และความแรงตรงกัน — ถ้าเป็นยาตัวเดียวกัน ให้เพิ่มเป็นชื่อที่ HOSxP ใช้เรียก ครั้งต่อไประบบจะตัดยอดให้เอง (ยอดของวันที่ผ่านมาแล้วต้องปรับด้วยมือ):'}
        {d.verdict === 'needs_review' && 'พบชื่อในไฟล์ที่คล้ายยานี้ แต่ยืนยันไม่ได้ว่าเป็นยาตัวเดียวกัน (ชื่อบางส่วนต่างกัน/ไม่ระบุความแรงครบ/อาจเป็นยาผสม) — ระบบจึงไม่เสนอให้ผูกชื่ออัตโนมัติ เพื่อกันตัดยอดผิดตัว ให้เภสัชกรตรวจเทียบชื่อด้านล่าง ถ้ายืนยันว่าเป็นตัวเดียวกัน ค่อยเพิ่มชื่อในหน้าแก้ไขยา:'}
        {d.verdict === 'strength_mismatch' && 'พบชื่อยาเดียวกันในไฟล์ แต่ความแรง/ขนาดต่างกัน — อาจเป็นคนละรายการ (เช่น 500 mg กับ 250 mg) ระบบจึงไม่แนะนำให้ผูกชื่อ ตรวจสอบกับเภสัชกรก่อน:'}
        {d.verdict === 'suspicious' && `ไม่มีชื่อใดในไฟล์ที่คล้ายยานี้เลย แต่${freq ?? 'ยานี้จ่ายเกือบทุกวัน'} — การที่ไม่มีในไฟล์เลยผิดปกติ ตรวจว่าไฟล์ดึงข้อมูลมาครบ หรือยานี้ในโปรแกรม HOSxP ใช้ชื่ออื่น (ค้นด้วยชื่อสามัญ)`}
        {d.verdict === 'likely_no_dispense' && `ไม่มีชื่อใดในไฟล์ที่คล้ายยานี้ — รายงาน HOSxP แสดงเฉพาะยาที่มีการจ่าย จึงน่าจะหมายถึงวันนั้นไม่มีการจ่ายยานี้ ไม่ต้องแก้${freq ? ' (' + freq + ')' : ''}`}
      </div>
      {d.candidates.map((c) => (
        <div key={c.fileName} style={{ marginTop: 6, border: '1px dashed var(--border)', borderRadius: 9, padding: '7px 9px' }}>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}><span className="muted">ชื่อในไฟล์: </span><b>{c.fileName}</b> <span className="muted">(คล้าย {Math.round(c.score * 100)}%)</span></div>
          <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            <span className="muted">ชื่อในแอพ: </span>{med.name}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {c.onlyInApp.length > 0 && <Badge flexNone size={10.5} padding="2px 7px" color="var(--amber-ink)" bg="var(--amber-bg)">แอพมีแต่: {c.onlyInApp.join(', ')}</Badge>}
            {c.onlyInFile.length > 0 && <Badge flexNone size={10.5} padding="2px 7px" color="var(--amber-ink)" bg="var(--amber-bg)">ไฟล์มีแต่: {c.onlyInFile.join(', ')}</Badge>}
            {c.numbers === 'differs' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--red)" bg="var(--red-bg)">ตัวเลขต่าง: แอพ {c.appNumbers.join('/')} · ไฟล์ {c.fileNumbers.join('/')}</Badge>}
            {c.numbers === 'equal' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--green)" bg="var(--green-tint)">ความแรงตรงกัน</Badge>}
            {c.numbers === 'unknown' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--muted)" bg="var(--bg-subtle)">ไม่ระบุความแรงอีกฝั่ง</Badge>}
          </div>
          {c.safe && state.role !== 'admin' && (
            <div className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>เพิ่มชื่อนี้ได้เฉพาะ Admin — แจ้ง Admin ให้เพิ่ม "{c.fileName}" เป็นชื่อ HOSxP ของยานี้</div>
          )}
          {c.safe && state.role === 'admin' && (
            done.has(c.fileName)
              ? <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--green)', fontWeight: 600 }}>✓ เพิ่มแล้ว</div>
              : <button type="button" disabled={busy === c.fileName} onClick={() => void add(c.fileName)} className="btn-primary" style={{ marginTop: 6, minHeight: 40, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                {busy === c.fileName ? 'กำลังเพิ่ม…' : 'เพิ่ม "' + c.fileName + '" เป็นชื่อ HOSxP ของยานี้'}
              </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onFixMed(med.id)} style={{ ...linkBtn, marginTop: 6, display: 'block' }}>แก้ไขชื่อยา/เพิ่มชื่อ HOSxP ที่รู้จัก →</button>
    </div>
  );
}

const linkBtn = { fontSize: 11.5, fontWeight: 600, color: 'var(--green)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' } as const;
