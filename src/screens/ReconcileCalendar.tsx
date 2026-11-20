import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { isoDate } from '../utils/format';
import type { DayMissKind, MedId, ReconcileMonthDay, ReconcileMonthStatus } from '../types';
import { Badge } from '../components/Badge';
import { MissDiagnosis } from './MissDiagnosis';

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const STATUS_STYLE: Record<ReconcileMonthStatus, { bg: string; color: string; border: string; label: string }> = {
  attached: { bg: 'var(--green-tint)', color: 'var(--green)', border: 'var(--green)', label: 'แนบแล้ว' },
  partial: { bg: 'var(--amber-bg)', color: 'var(--amber-ink)', border: 'var(--amber)', label: 'แนบแล้วแต่ตัดไม่ครบ' },
  missing: { bg: 'var(--red-bg)', color: 'var(--red)', border: 'var(--red)', label: 'ยังไม่แนบ' },
  weekend: { bg: 'var(--bg-subtle)', color: 'var(--muted)', border: 'var(--border)', label: 'เสาร์-อาทิตย์ (ไม่ต้องแนบ)' },
  today: { bg: 'var(--bg-card)', color: 'var(--ink)', border: 'var(--border)', label: 'วันนี้ (ยังไม่ถึงเวลาแนบ)' },
  future: { bg: 'transparent', color: 'var(--muted)', border: 'transparent', label: 'ยังไม่ถึงวัน' },
};

// Plain-Thai explanation per reason, written so the person reading it knows WHERE the problem is
// and what to do — not just that something is wrong.
export const DAY_REASON: Record<DayMissKind, { badge: string; color: string; bg: string; text: string; fixable: boolean }> = {
  zero_qty: { badge: 'จำนวน 0', color: 'var(--green)', bg: 'var(--green-tint)', text: 'ไฟล์ระบุจำนวนที่จ่ายเป็น 0 — วันนั้นไม่มีการจ่ายยาตัวนี้ จึงไม่ได้ตัดยอด (ปกติ ไม่ต้องแก้)', fixable: false },
  not_in_file: { badge: 'ไม่พบในไฟล์', color: 'var(--amber-ink)', bg: 'var(--amber-bg)', text: 'ไม่พบชื่อยาตัวนี้ในไฟล์เลย — เป็นไปได้ 2 อย่าง: (1) วันนั้นไม่มีการจ่ายยาตัวนี้ (รายงาน HOSxP แสดงเฉพาะยาที่มีการจ่าย จึงไม่มีแถว/จำนวนเป็น 0) ไม่ต้องแก้ หรือ (2) วันนั้นมีการจ่ายจริงแต่ชื่อในไฟล์ต่างจากชื่อในแอพ จึงจับคู่ไม่ได้ — ดูรายการ "ชื่อในไฟล์ที่จับคู่ไม่ได้" ด้านล่างว่ามีชื่อที่คล้ายกันไหม แล้วแก้ชื่อ/เพิ่มชื่อที่ HOSxP ใช้เรียก', fixable: true },
  ambiguous: { badge: 'ชื่อกำกวม', color: 'var(--red)', bg: 'var(--red-bg)', text: 'ชื่อในไฟล์ตรงกับยามากกว่า 1 รายการในแอพ (เช่น ยาชื่อเดียวกันทั้งฝั่ง OPD และ IPD) ระบบจึงไม่กล้าตัดยอดให้ — ต้องแก้ชื่อให้ไม่ซ้ำกัน', fixable: true },
  unknown: { badge: 'ไม่ทราบสาเหตุ', color: 'var(--muted)', bg: 'var(--bg-subtle)', text: 'ไม่มีบันทึกเหตุผลของวันนี้ (ตัดยอดก่อนระบบเริ่มจดเหตุผล หรือบันทึกเก่าเกินช่วงที่เก็บไว้) — ลองแนบไฟล์วันนั้นใหม่ถ้ายังไม่แน่ใจ', fixable: true },
};

function monthIsoOf(ms: number): string {
  return isoDate(ms).slice(0, 7);
}
function shiftMonth(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** Month calendar of HOSxP file attachment: which days a file covers, which are still missing, and
 * for each day WHY any regularly-dispensed med was not deducted. Tap a day for the detail. */
export default function ReconcileCalendar({ onFixMed }: { onFixMed: (id: MedId) => void }) {
  const { fetchReconcileMonth, state, toast } = useApp();
  const [monthIso, setMonthIso] = useState(() => monthIsoOf(Date.now()));
  const [days, setDays] = useState<ReconcileMonthDay[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const reqId = useRef(0);

  // fetchReconcileMonth's identity changes with every meds/audit-log snapshot (it reads both) — the
  // audit-log part matters: the screen-scoped auditLog listener starts AFTER mount and carries the
  // per-day miss reasons, so a refetch when it arrives is wanted. But refetching immediately on every
  // stock change blanked the calendar, closed the open day, and re-read the month's txs each time.
  // So: a month change loads immediately (blanking, as before); any other trigger refreshes quietly
  // (old days stay on screen, selection kept) after a short debounce.
  const loadedMonth = useRef<string | null>(null);
  useEffect(() => {
    if (state.busy['reconcile']) return;
    const monthChanged = loadedMonth.current !== monthIso;
    const run = () => {
      const id = ++reqId.current;
      if (monthChanged) { setDays(null); loadedMonth.current = monthIso; }
      fetchReconcileMonth(monthIso).then((d) => {
        if (id === reqId.current) setDays(d);
      }).catch((e) => {
        if (id === reqId.current) toast((e as Error)?.message || 'โหลดปฏิทินการแนบไฟล์ไม่สำเร็จ');
      });
    };
    if (monthChanged) { run(); return; }
    const t = window.setTimeout(run, 1500);
    return () => window.clearTimeout(t);
  }, [monthIso, fetchReconcileMonth, state.busy, toast]);

  const [y, m] = monthIso.split('-').map(Number);
  const firstWd = new Date(y, m - 1, 1).getDay();
  const todayIso = isoDate(Date.now());
  const isCurrentMonth = monthIso === monthIsoOf(Date.now());
  const selectedDay = days?.find((d) => d.dateIso === selected) ?? null;
  const counts = days ? {
    attached: days.filter((d) => d.status === 'attached').length,
    partial: days.filter((d) => d.status === 'partial').length,
    missing: days.filter((d) => d.status === 'missing').length,
  } : null;

  return (
    <div className="card" style={{ marginBottom: 14, padding: 14 }} data-testid="reconcile-calendar">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button aria-label="เดือนก่อนหน้า" onClick={() => { setSelected(null); setMonthIso(shiftMonth(monthIso, -1)); }} className="btn-outline" style={{ minWidth: 44, minHeight: 40, borderRadius: 9, fontSize: 16 }}>‹</button>
        <div style={{ fontSize: 14, fontWeight: 700 }}>ปฏิทินการแนบไฟล์ HOSxP · {TH_MONTHS[m - 1]} {y + 543}</div>
        <button aria-label="เดือนถัดไป" disabled={isCurrentMonth} onClick={() => { setSelected(null); setMonthIso(shiftMonth(monthIso, 1)); }} className="btn-outline" style={{ minWidth: 44, minHeight: 40, borderRadius: 9, fontSize: 16, opacity: isCurrentMonth ? 0.35 : 1 }}>›</button>
      </div>

      {counts && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 11.5 }}>
          <Badge flexNone size={11} padding="3px 8px" color="var(--green)" bg="var(--green-tint)">แนบแล้ว {counts.attached} วัน</Badge>
          <Badge flexNone size={11} padding="3px 8px" color="var(--amber-ink)" bg="var(--amber-bg)">ตัดไม่ครบ {counts.partial} วัน</Badge>
          <Badge flexNone size={11} padding="3px 8px" color="var(--red)" bg="var(--red-bg)">ยังไม่แนบ {counts.missing} วัน</Badge>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {TH_WEEKDAYS.map((w) => <div key={w} className="muted" style={{ textAlign: 'center', fontSize: 11, fontWeight: 600 }}>{w}</div>)}
        {Array.from({ length: firstWd }).map((_, i) => <div key={'pad' + i} />)}
        {(days ?? Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => null)).map((d, i) => {
          const dateIso = d ? d.dateIso : monthIso + '-' + String(i + 1).padStart(2, '0');
          const st = d ? STATUS_STYLE[d.status] : STATUS_STYLE.future;
          const isSel = selected === dateIso;
          return (
            <button
              key={dateIso}
              disabled={!d || d.status === 'future'}
              onClick={() => setSelected(isSel ? null : dateIso)}
              aria-label={Number(dateIso.slice(8)) + ' ' + TH_MONTHS[m - 1] + (d ? ' — ' + st.label : '')}
              data-status={d?.status}
              style={{
                minHeight: 44, borderRadius: 9, fontSize: 13, fontWeight: 600, padding: 2,
                background: st.bg, color: st.color,
                border: (isSel ? '2px solid var(--ink)' : dateIso === todayIso ? '2px dashed var(--green)' : '1px solid ' + st.border),
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.2,
              }}
            >
              <span>{Number(dateIso.slice(8))}</span>
              {d && d.status === 'attached' && <span style={{ fontSize: 10 }}>✓</span>}
              {d && d.status === 'partial' && <span style={{ fontSize: 10 }}>{d.missing.length}!</span>}
              {d && d.status === 'missing' && <span style={{ fontSize: 10 }}>✗</span>}
            </button>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        ✓ แนบแล้ว · เลข! = จำนวนยาปกติจ่ายที่ไม่ถูกตัด · ✗ ยังไม่แนบ · เสาร์-อาทิตย์ที่ไม่มีไฟล์ไม่นับว่าขาด (ไฟล์วันจันทร์ที่ครอบคลุมศุกร์-อาทิตย์จะทำให้ทั้งสามวันขึ้นว่าแนบแล้ว) · แตะวันที่เพื่อดูรายละเอียด
      </div>

      {selectedDay && <ReconcileDayDetail day={selectedDay} onFixMed={onFixMed} />}
    </div>
  );
}

/** Per-day detail: which regularly-dispensed meds were not deducted and WHY (with a jump to fix the
 * med name). Shared by the month calendar and the "ตรวจสอบความครบถ้วน" list on ReconcileScreen. */
export function ReconcileDayDetail({ day, onFixMed }: { day: ReconcileMonthDay; onFixMed: (id: MedId) => void }) {
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-soft)', paddingTop: 10 }} data-testid="reconcile-day-detail">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{Number(day.dateIso.slice(8))} {TH_MONTHS[Number(day.dateIso.slice(5, 7)) - 1]} {Number(day.dateIso.slice(0, 4)) + 543} — {STATUS_STYLE[day.status].label}</div>
          {day.status === 'missing' && (
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--red)' }}>ยังไม่มีการแนบไฟล์ HOSxP ที่ครอบคลุมวันนี้ — ยาทุกตัวของวันนี้ยังไม่ถูกตัดยอด ให้ดึงรายงานการใช้ยาของวันนี้จาก HOSxP แล้วแนบด้านบน (ระบุช่วงวันที่ให้ตรงกับวันนี้)</div>
          )}
          {day.status === 'weekend' && <div className="muted" style={{ fontSize: 12.5 }}>วันหยุดสุดสัปดาห์ — ไม่ต้องแนบไฟล์แยก (ไฟล์วันจันทร์ครอบคลุมศุกร์-อาทิตย์ได้)</div>}
          {(day.status === 'attached' || day.status === 'partial') && (
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>ตัดยอดแล้ว {day.deductedCount} รายการยา</div>
          )}
          {day.completeness && day.status === 'partial' && <CompletenessBanner c={day.completeness} deducted={day.deductedCount} />}
          {day.status === 'attached' && <div style={{ fontSize: 12.5, color: 'var(--green)' }}>ยาที่ปกติมีการจ่ายถูกตัดยอดครบทุกตัว</div>}
          {day.missing.length > 0 && (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>ยาที่ปกติมีการจ่ายแต่ยังไม่ถูกตัดยอดในวันนี้ ({day.missing.length} รายการ) และสาเหตุ</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {day.missing.map(({ med, reason }) => {
                  const r = DAY_REASON[reason];
                  return (
                    <div key={med.id} style={{ border: '1px solid var(--border-soft)', borderRadius: 10, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{med.name}</span>
                        <Badge flexNone size={10.5} padding="2px 7px" color={r.color} bg={r.bg}>{r.badge}</Badge>
                      </div>
                      {reason === 'not_in_file' || reason === 'unknown'
                        ? <MissDiagnosis med={med} fileNames={day.unmatchedNames} onFixMed={onFixMed} />
                        : (
                          <>
                            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 4 }}>{r.text}</div>
                            {r.fixable && (
                              <button onClick={() => onFixMed(med.id)} className="btn-outline" style={{ marginTop: 6, minHeight: 36, padding: '6px 10px', borderRadius: 8, fontSize: 12 }}>ไปแก้ชื่อยานี้</button>
                            )}
                          </>
                        )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {day.unmatchedNames.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600 }}>ชื่อในไฟล์ที่จับคู่กับยาในแอพไม่ได้ ({day.unmatchedNames.length} รายการ)</div>
              <div className="muted">{day.unmatchedNames.slice(0, 15).join(' · ')}{day.unmatchedNames.length > 15 ? ' …' : ''}</div>
              <div className="muted">ถ้าชื่อใดคือยาที่มีในแอพ ให้เพิ่มเป็น "ชื่อที่ไฟล์ HOSxP อาจใช้เรียกยานี้" ในหน้ายา</div>
            </div>
          )}
        </div>
  );
}

/** Day-level answer to "is the file complete, or are the missing drugs just not dispensed?" — with the evidence. */
function CompletenessBanner({ c, deducted }: { c: NonNullable<ReconcileMonthDay['completeness']>; deducted: number }) {
  const ui = c.verdict === 'complete' ? { color: 'var(--green)', bg: 'var(--green-tint)', head: '✓ ไฟล์ของวันนี้ดูครบถ้วนตามปกติ' }
    : c.verdict === 'incomplete' ? { color: 'var(--red)', bg: 'var(--red-bg)', head: '⚠ ไฟล์ของวันนี้อาจไม่ครบ' }
      : { color: 'var(--muted)', bg: 'var(--bg-subtle)', head: 'ยังประเมินความครบถ้วนของไฟล์วันนี้ไม่ได้ (ข้อมูลเปรียบเทียบไม่พอ)' };
  return (
    <div data-testid="file-completeness" data-verdict={c.verdict} style={{ background: ui.bg, borderRadius: 10, padding: '9px 11px', marginBottom: 10, fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, color: ui.color }}>{ui.head}</div>
      <div>
        {c.typicalDeducted !== null && <>ไฟล์นี้ตัดยา <b>{deducted}</b> รายการ (วันทั่วไปประมาณ {c.typicalDeducted}) · </>}
        ยาที่ไม่พบ <b>{c.actualAbsent}</b> รายการ (วันปกติคาดว่าจะไม่มีการจ่ายประมาณ {c.expectedAbsent} รายการ จากความถี่การจ่ายของยาแต่ละตัว)
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {c.verdict === 'complete' && 'ขนาดไฟล์และจำนวนยาที่ไม่พบอยู่ในช่วงปกติ — ยาที่ไม่พบส่วนใหญ่น่าจะไม่มีการจ่ายวันนั้นจริง (ยกเว้นตัวที่ขึ้นว่า "ชื่อคล้าย"/"น่าสงสัย" ด้านล่าง)'}
        {c.verdict === 'incomplete' && 'มียาน้อยกว่าวันทั่วไปหรือไม่พบมากกว่าที่ควร — ตรวจว่ารายงาน HOSxP ดึงข้อมูลครบทั้งวันหรือไม่ แล้วแนบไฟล์ใหม่ (ระบบข้ามแถวที่ตัดไปแล้ว ไม่ตัดซ้ำ)'}
        {c.verdict === 'unknown' && 'ยังไม่มีวันก่อนหน้าให้เทียบขนาดไฟล์'}
        {' '}หมายเหตุ: ไฟล์ HOSxP มีเฉพาะยาที่จ่าย จึงพิสูจน์ 100% ไม่ได้ว่ายาตัวหนึ่ง "ไม่ได้จ่าย" — นี่คือหลักฐานจากสถิติ
      </div>
    </div>
  );
}
