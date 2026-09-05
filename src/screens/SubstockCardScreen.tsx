import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react';
import { useApp } from '../store/AppContext';
import { subQty, wardOf } from '../store/selectors';
import { nf, thDate, fiscalYear } from '../utils/format';
import { printSubstockCardSheet } from '../utils/print';
import { downloadCsv } from '../utils/csv';
import { MedDot } from '../components/MedDot';
import { WardBadge } from '../components/WardBadge';

const inputStyle = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44 };

interface LedgerRow { ts: number; type: string; qty: number; note: string; by: string; balance: number }

// Traceability fix: "จ่าย" alone doesn't say WHY stock left substock — เติมหน้างาน (normal
// dispensing to the floor) and ตัดหมดอายุ (writing off an expired lot) both showed as an
// identical red number with nothing to tell them apart, which is exactly the kind of thing a
// real stock-card review needs to distinguish at a glance. One small icon+label per row fixes
// it without touching the color-coded รับ/จ่าย columns already in place.
const TYPE_META: Record<string, { icon: string; label: string }> = {
  receive_from_central: { icon: '📥', label: 'รับจากคลังใหญ่' },
  transfer_to_floor: { icon: '🚚', label: 'เติมหน้างาน' },
  expired: { icon: '🗑️', label: 'ตัดหมดอายุ' },
};

/** The digital replacement for the paper "บัตรคุมสต็อกยา" (yellow stock card) — same
 * วันที่/รับ/จ่าย/คงเหลือ layout staff already read off the physical card, generated from real
 * substock transaction history instead of copied there by hand. Pick a med, see it on screen
 * live, or print an A4 sheet in the same shape as the card for anyone who still wants a
 * physical printout on file. */
export default function SubstockCardScreen() {
  const { state, fetchSubstockLedger, toast, setSubstockFocusId } = useApp();
  const [search, setSearch] = useState('');
  const [medId, setMedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  // ปีงบประมาณที่กำลังดู — 'all' ดูทุกปีที่มีข้อมูล (บัตรกระดาษเดิมต้องเปลี่ยนแผ่นทุกปีงบประมาณ,
  // แต่ที่นี่เก็บได้ไม่จำกัดปีแล้วสลับดูย้อนหลังได้ทันทีโดยไม่ต้องโหลดใหม่ — คำนวณคงเหลือสะสม
  // จากประวัติทั้งหมดเสมอ ไม่ว่าจะกรองปีไหนอยู่ ยอดคงเหลือในแต่ละแถวจึงถูกต้องเสมอ)
  const [year, setYear] = useState<number | 'all'>('all');

  const med = medId ? state.meds.find((m) => m.id === medId) : null;
  const options = !medId && search.trim()
    ? state.meds.filter((m) => m.active && m.name.toLowerCase().indexOf(search.trim().toLowerCase()) >= 0).slice(0, 10)
    : [];

  const openCard = async (id: string) => {
    const m = state.meds.find((x) => x.id === id);
    if (!m) return;
    setMedId(id);
    setSearch(m.name);
    setLoading(true);
    setRows(null);
    setYear('all');
    try {
      const ledger = await fetchSubstockLedger(id);
      setRows(ledger);
      // Default to whichever fiscal year is most relevant to look at right now: this year's
      // (ปีงบประมาณปัจจุบัน) if it already has activity, otherwise the most recent year that
      // does — never lands on an empty screen for a drug whose last movement was last year.
      const curFy = fiscalYear();
      const fys = new Set(ledger.map((r) => fiscalYear(r.ts)));
      if (fys.has(curFy)) setYear(curFy);
      else if (fys.size) setYear(Math.max(...fys));
    } catch (e) {
      console.error(e);
      toast('ดึงประวัติบัตรสต็อกไม่สำเร็จ — ต้องใช้อินเทอร์เน็ต ลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  // All fiscal years that have at least one row, newest first — populates the year dropdown.
  const years = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => fiscalYear(r.ts)))).sort((a, b) => b - a);
  }, [rows]);

  // Rows to actually render/print/export — the running balance on each row was already
  // computed over the FULL history in fetchSubstockLedger, so filtering down to one fiscal
  // year here for display never has to touch that math again.
  const viewRows = useMemo(() => {
    if (!rows) return null;
    return year === 'all' ? rows : rows.filter((r) => fiscalYear(r.ts) === year);
  }, [rows, year]);

  const yearTotals = useMemo(() => {
    if (!viewRows) return null;
    let received = 0, dispensed = 0, expired = 0;
    for (const r of viewRows) {
      if (r.qty > 0) received += r.qty;
      else if (r.type === 'expired') expired += -r.qty;
      else dispensed += -r.qty;
    }
    return { received, dispensed, expired, net: received - dispensed - expired };
  }, [viewRows]);

  // Arrived here from DoneScreen's "ดูบัตรสต็อก" right after a receive/transfer — open that
  // med's card immediately instead of landing on an empty search box.
  useEffect(() => {
    if (!state.substockFocusId) return;
    const id = state.substockFocusId;
    setSubstockFocusId(null);
    openCard(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.substockFocusId]);

  const liveBalance = med ? subQty(state, med.id) : 0;
  const lastLedgerBalance = rows && rows.length ? rows[rows.length - 1].balance : 0;
  // The live balance (from current lots) and the ledger's computed running total should
  // always agree — if they don't, something in the tx history is incomplete or a lot was
  // touched outside the normal receive/transfer/scrap paths. Surface the mismatch rather
  // than silently showing two different numbers.
  const mismatch = rows && rows.length > 0 && liveBalance !== lastLedgerBalance;
  // Same drug on both OPD and IPD shelves (same name, separate records — see wardOf) means
  // the ledger only trusts tx rows explicitly tagged with this med's id, so anything logged
  // before that tagging existed won't appear here even though it's the right drug's history.
  // Worth naming specifically — it looks identical to a real discrepancy otherwise, and "check
  // the audit log" (the generic mismatch message) isn't the actual right next step for it.
  // Bug fix: this used to also match a deactivated ex-sibling left behind by "รวมสต็อก
  // OPD+IPD" (mergeWardMeds/mergeAllWardPairs — see AppContext.tsx) — that record still shares
  // the name but isn't a live ambiguity anymore (it's zeroed out and inactive, its stock
  // already folded into this one), so warning about it here was just wrong once merged.
  const hasNameTwin = med ? state.meds.some((x) => x.id !== med.id && x.active && x.name === med.name) : false;

  const printCard = () => {
    if (!med || !viewRows) return;
    const cardRows = viewRows.map((r) => ({
      ts: r.ts, received: r.qty > 0 ? r.qty : 0, dispensed: r.qty < 0 ? -r.qty : 0, balance: r.balance, by: r.by,
    }));
    const ok = printSubstockCardSheet({ code: med.code, name: med.name, parSub: med.parSub, unit: med.unit, ward: wardOf(med) }, cardRows, year);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  };

  const exportCard = async () => {
    if (!med || !viewRows) return;
    const header = ['วันที่', 'ประเภท', 'รับ', 'จ่าย', 'คงเหลือ', 'โดย', 'หมายเหตุ'];
    const body = viewRows.map((r) => [
      thDate(r.ts), TYPE_META[r.type]?.label || r.type,
      r.qty > 0 ? r.qty : '', r.qty < 0 ? -r.qty : '', r.balance, r.by, r.note,
    ]);
    const fname = 'substock_card_' + med.code + '_' + (year === 'all' ? 'ทุกปี' : 'FY' + year) + '.csv';
    const outcome = await downloadCsv([header, ...body], fname);
    toast(outcome === 'saved' ? 'ดาวน์โหลด CSV แล้ว' : outcome === 'declined' ? 'ยกเลิกการบันทึกไฟล์' : 'ดาวน์โหลดไม่สำเร็จ — เบราว์เซอร์นี้ไม่รองรับ');
  };

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        เลือกยาเพื่อดูบัตรสต็อก substock แบบ real-time — รับจากคลังใหญ่ / เติมหน้างาน / ตัดหมดอายุ พร้อมยอดคงเหลือสะสม แทนบัตรกระดาษที่ต้องจดมือ
      </div>

      {!medId && (
        <>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อยา" style={inputStyle} />
          {options.length > 0 && (
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 280, overflowY: 'auto', marginTop: 9 }}>
              {options.map((m) => (
                <button key={m.id} onClick={() => openCard(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 12px', minHeight: 44 }}>
                  <span style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={m.code} /> {m.name} <WardBadge med={m} /></span>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>substock ปัจจุบัน {nf(subQty(state, m.id))} {m.unit}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {med && (
        <>
          {/* Styled after the real hand-written yellow "บัตรคุมสต็อกยา" ledger card — a boxed
              amber header band + a labeled field grid (same as the card's ruled ชื่อยา/รหัส/
              หน่วยนับ boxes), instead of a plain flat list. Data underneath is still live —
              this is a skin over the same real-time subQty()/fetchSubstockLedger() plumbing. */}
          <div style={{ border: '1.5px solid var(--amber)', borderRadius: 14, overflow: 'hidden', marginBottom: 14, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ background: 'var(--amber)', color: '#2a1f0a', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '.01em' }}>บัตรคุมสต็อกยา</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Multi-year history browser — the paper card needed a new sheet every fiscal
                    year; this keeps every year in one record and lets you flip between them,
                    "ทั้งหมด" pooling every year ever recorded for this drug into one view. */}
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  style={{ border: '1px solid rgba(42,31,10,.35)', background: 'rgba(255,255,255,.55)', color: '#2a1f0a', padding: '5px 8px', borderRadius: 8, fontSize: 11.5, fontWeight: 700 }}
                >
                  {years.length === 0 && <option value={fiscalYear()}>ปีงบประมาณ {fiscalYear()}</option>}
                  {years.map((y) => <option key={y} value={y}>ปีงบ {y}</option>)}
                  <option value="all">ทุกปี</option>
                </select>
                <button onClick={() => { setMedId(null); setSearch(''); setRows(null); }} style={{ border: '1px solid rgba(42,31,10,.35)', background: 'rgba(255,255,255,.35)', color: '#2a1f0a', padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600 }}>เปลี่ยนยา</button>
              </div>
            </div>
            <div style={{ background: 'var(--amber-bg)', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <Field label="ชื่อยา" full><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MedDot code={med.code} size={9} />{med.name} <WardBadge med={med} size="md" /></span></Field>
              <Field label="รหัสยา">{med.code}</Field>
              <Field label="หน่วยนับ" noBorderRight>{med.unit}</Field>
              <Field label="par substock" noBorder>{nf(med.parSub)} {med.unit}</Field>
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--bg-card)', display: 'flex', gap: 10 }}>
              {/* The one number everyone actually walks up to this screen for — sized to read
                  from arm's length, not squeezed next to the print button as small text. */}
              <div style={{ flex: 1, background: 'var(--green-tint)', borderRadius: 10, padding: '10px 12px' }}>
                <div className="muted" style={{ fontSize: 11 }}>substock คงเหลือตอนนี้ (real-time)</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--green)', lineHeight: 1.15 }}>{nf(liveBalance)} <span style={{ fontSize: 13, fontWeight: 600 }}>{med.unit}</span></div>
              </div>
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  onClick={printCard}
                  disabled={!viewRows}
                  title="พิมพ์บัตรสต็อก"
                  className="press-spring"
                  style={{ flex: 1, width: 54, border: '1px solid var(--border)', background: 'var(--bg-card)', color: viewRows ? 'var(--ink)' : 'var(--muted)', borderRadius: 10, fontSize: 19 }}
                >
                  🖨
                </button>
                <button
                  onClick={exportCard}
                  disabled={!viewRows}
                  title="ดาวน์โหลดเป็น CSV"
                  className="press-spring"
                  style={{ flex: 1, width: 54, border: '1px solid var(--border)', background: 'var(--bg-card)', color: viewRows ? 'var(--ink)' : 'var(--muted)', borderRadius: 10, fontSize: 17 }}
                >
                  ⬇
                </button>
              </div>
            </div>

            {/* Period summary — the "how much moved this year" picture the flat row-by-row
                ledger doesn't give at a glance, right below the live balance so both read
                together: what's on the shelf now, and what it took to get there. */}
            {yearTotals && viewRows && viewRows.length > 0 && (
              <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: yearTotals.expired > 0 ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8 }}>
                <SummaryTile label="รับเข้ารวม" value={yearTotals.received} unit={med.unit} color="var(--green)" />
                <SummaryTile label="เติมหน้างานรวม" value={yearTotals.dispensed} unit={med.unit} color="var(--red)" />
                {yearTotals.expired > 0 && <SummaryTile label="ตัดหมดอายุรวม" value={yearTotals.expired} unit={med.unit} color="var(--amber-ink)" />}
              </div>
            )}
            {mismatch && (
              <div style={{ fontSize: 11, color: 'var(--amber-ink)', background: 'var(--amber-bg)', padding: '9px 14px', lineHeight: 1.5, borderTop: '1px solid var(--amber-border)' }}>
                {hasNameTwin
                  ? `ยานี้มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน — ยอดจากประวัติ (${nf(lastLedgerBalance)} ${med.unit}) อาจไม่ครบตั้งแต่ก่อนระบบแยกประวัติตาม ward ได้ ยอดคงเหลือจริงด้านบนยังถูกต้องเสมอ`
                  : `ยอดจากประวัติธุรกรรม (${nf(lastLedgerBalance)} ${med.unit}) ไม่ตรงกับยอดจริงตอนนี้ — อาจมีการปรับยอดนอกช่องทางปกติ ลองตรวจสอบใน Audit log`}
              </div>
            )}
          </div>

          {loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)', fontSize: 13 }}>กำลังโหลดประวัติ…</div>}

          {viewRows && !loading && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }} className="stagger">
              {/* A real ruled grid (vertical + horizontal cell borders), not just underlines —
                  same shape as the physical card: ลำดับ / วันที่ / รับ / จ่าย / คงเหลือ / โดย,
                  chronological oldest-first, read top-to-bottom like the paper it replaces. */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    <Th w={28}>#</Th><Th w={26} /><Th w={58}>วันที่</Th><Th w={54} num>รับ</Th><Th w={54} num>จ่าย</Th><Th w={62} num>คงเหลือ</Th><Th>โดย</Th>
                  </tr>
                </thead>
                <tbody>
                  {viewRows.map((r, i) => {
                    const meta = TYPE_META[r.type];
                    const title = (meta ? meta.label : r.type) + (r.note ? ' — ' + r.note : '');
                    return (
                      <tr key={i} title={title}>
                        <Td num style={{ color: 'var(--muted)', fontSize: 10.5 }}>{i + 1}</Td>
                        <Td style={{ textAlign: 'center', fontSize: 12 }}>{meta ? meta.icon : ''}</Td>
                        <Td>{thDate(r.ts)}</Td>
                        <Td num style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>{r.qty > 0 ? nf(r.qty) : ''}</Td>
                        <Td num style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)' }}>{r.qty < 0 ? nf(-r.qty) : ''}</Td>
                        <Td num style={{ fontWeight: 800, fontSize: 13.5 }}>{nf(r.balance)}</Td>
                        <Td style={{ color: 'var(--muted)', fontSize: 10.5, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.by}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {viewRows.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
                  {rows && rows.length > 0 ? 'ไม่มีประวัติ substock ใน' + (year === 'all' ? 'ช่วงนี้' : 'ปีงบ ' + year) : 'ยานี้ยังไม่มีประวัติ substock'}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One labeled cell in the header's field grid — mirrors the paper card's ruled ชื่อยา/รหัส/
 * หน่วยนับ boxes: a small caption above the value, boxed in on the right/bottom by default. */
function Field({ label, children, full, noBorder, noBorderRight }: { label: string; children: ReactNode; full?: boolean; noBorder?: boolean; noBorderRight?: boolean }) {
  return (
    <div style={{
      gridColumn: full ? '1 / -1' : undefined,
      padding: '7px 14px',
      borderBottom: noBorder ? 0 : '1px solid var(--amber-border)',
      borderRight: full || noBorderRight || noBorder ? 0 : '1px solid var(--amber-border)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber-ink)', opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{children}</div>
    </div>
  );
}

/** One period-total number, big and unambiguous — "how much moved" alongside "how much is
 * left now" (the live balance card above it). */
function SummaryTile({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div style={{ background: 'var(--bg-subtle)', borderRadius: 10, padding: '9px 11px' }}>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.2 }}>{nf(value)} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>{unit}</span></div>
    </div>
  );
}

function Th({ children, w, num }: { children?: ReactNode; w?: number; num?: boolean }) {
  return (
    <th style={{ width: w, textAlign: num ? 'right' : 'left', fontSize: 10, color: 'var(--muted)', fontWeight: 700, padding: '8px 10px', border: '1px solid var(--border-soft)' }}>{children}</th>
  );
}

function Td({ children, num, style }: { children?: ReactNode; num?: boolean; style?: CSSProperties }) {
  return (
    <td style={{ textAlign: num ? 'right' : 'left', fontSize: 12, padding: '7px 10px', border: '1px solid var(--border-soft)', ...style }}>{children}</td>
  );
}
