import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react';
import { useApp } from '../store/AppContext';
import { subQty, wardOf, subTone } from '../store/selectors';
import { nf, thDate, fiscalYear } from '../utils/format';
import { printSubstockCardSheet } from '../utils/print';
import { downloadCsv } from '../utils/csv';
import { MedDot } from '../components/MedDot';
import { WardBadge } from '../components/WardBadge';
import { SkeletonList } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';

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
  // Only ever reaches this ledger tagged loc:'substock' (see fetchSubstockLedger's guard in
  // AppContext.tsx) — a floor count logs the same type but never appears here.
  count: { icon: '🔢', label: 'นับสต็อก (ปรับยอด)' },
};

/** The digital replacement for the paper "บัตรคุมสต็อกยา" (yellow stock card) — same
 * วันที่/รับ/จ่าย/คงเหลือ layout staff already read off the physical card, generated from real
 * substock transaction history instead of copied there by hand. Pick a med, see it on screen
 * live, or print an A4 sheet in the same shape as the card for anyone who still wants a
 * physical printout on file. */
export default function SubstockCardScreen() {
  const { state, fetchSubstockLedger, toast, setSubstockFocusId, go, setAdminTab, setAuditFilter } = useApp();
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
    let received = 0, dispensed = 0, expired = 0, counted = 0;
    for (const r of viewRows) {
      // Bug fix: a substock count adjustment (type:'count', either sign — commitSubCount) used
      // to fall through into "received" (any positive qty) or "dispensed" (any non-'expired'
      // negative qty) here, mislabeling a shrinkage found during a cycle count as if it had
      // really been transferred out to the floor, or a surplus found as if it had really come
      // from the central warehouse — neither happened. Give it its own bucket instead.
      if (r.type === 'count') counted += r.qty;
      else if (r.qty > 0) received += r.qty;
      else if (r.type === 'expired') expired += -r.qty;
      else dispensed += -r.qty;
    }
    return { received, dispensed, expired, counted, net: received - dispensed - expired + counted };
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
  const balanceTone = med ? subTone(liveBalance, med.parSub) : 'var(--green)';
  const balancePct = med ? Math.round((liveBalance / Math.max(1, med.parSub)) * 100) : 0;
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
          <SearchInput value={search} onChange={setSearch} placeholder="ค้นหาชื่อยา" onEnter={options.length === 1 ? () => openCard(options[0].id) : undefined} />
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
          {/* Styled after the real hand-written yellow "บัตรคุมสต็อกยา" ledger card — kept the
              amber identity (staff already recognize that color as "this is the stock card"),
              but with a more deliberate, formal chrome: a gradient header with a thin animated
              highlight (same premium-chrome language LoginScreen's card uses), deeper shadow,
              more generous radius — a real elevated instrument panel rather than a flat colored
              box. Data underneath is still live — this is a skin over the same real-time
              subQty()/fetchSubstockLedger() plumbing. */}
          <div style={{ position: 'relative', border: '1px solid var(--amber)', borderRadius: 18, overflow: 'hidden', marginBottom: 14, boxShadow: '0 14px 34px -16px rgba(120,80,10,.35), var(--shadow-sm)' }}>
            <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent, #fff, rgba(255,255,255,.4), #fff, transparent)', backgroundSize: '200% 100%', animation: 'aiGradientShift 4.5s ease-in-out infinite', zIndex: 1 }} />
            <div style={{ background: 'linear-gradient(135deg, #f0b429 0%, var(--amber) 100%)', color: '#2a1f0a', padding: '12px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '.02em', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🗂️</span>
                บัตรคุมสต็อกยา
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Multi-year history browser — the paper card needed a new sheet every fiscal
                    year; this keeps every year in one record and lets you flip between them,
                    "ทั้งหมด" pooling every year ever recorded for this drug into one view. */}
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  // Bug fix (mobile fit): a <select> under 16px triggers the same iOS Safari
                  // auto-zoom-on-focus as a text input — tapping this year picker zoomed the
                  // whole page in. Padding trimmed slightly to keep the pill's proportions
                  // close to before now that the text itself is bigger.
                  style={{ border: '1px solid rgba(42,31,10,.35)', background: 'rgba(255,255,255,.6)', color: '#2a1f0a', padding: '4px 6px', borderRadius: 8, fontSize: 16, fontWeight: 700 }}
                >
                  {years.length === 0 && <option value={fiscalYear()}>ปีงบประมาณ {fiscalYear()}</option>}
                  {years.map((y) => <option key={y} value={y}>ปีงบ {y}</option>)}
                  <option value="all">ทุกปี</option>
                </select>
                <button onClick={() => { setMedId(null); setSearch(''); setRows(null); }} style={{ border: '1px solid rgba(42,31,10,.35)', background: 'rgba(255,255,255,.4)', color: '#2a1f0a', padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600 }}>เปลี่ยนยา</button>
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
                  from arm's length, not squeezed next to the print button as small text. Now
                  colored/bar'd against par substock (same red/amber/green bands as the rest of
                  the app's toneFor()-driven screens) instead of a flat green box regardless of
                  whether 6,150 of 15,700 is actually fine or a problem — the raw number alone
                  never said which, and reading that off by mental math isn't "เห็นภาพชัดเจน". */}
              <div style={{ flex: 1, background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '11px 13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span className="muted" style={{ fontSize: 11 }}>substock คงเหลือตอนนี้ (real-time)</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: balanceTone }}>{balancePct}% ของ par</span>
                </div>
                <div style={{ fontSize: 30, fontWeight: 800, color: balanceTone, lineHeight: 1.15, marginTop: 2 }}>{nf(liveBalance)} <span style={{ fontSize: 13, fontWeight: 600 }}>{med.unit}</span></div>
                <div className="bar-track" style={{ height: 5, background: 'var(--border-soft)', borderRadius: 3, marginTop: 8 }}>
                  <div className="bar-fill" style={{ height: '100%', width: Math.max(3, Math.min(100, balancePct)) + '%', background: balanceTone, borderRadius: 3 }} />
                </div>
              </div>
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  onClick={printCard}
                  disabled={!viewRows}
                  title="พิมพ์บัตรสต็อก"
                  aria-label="พิมพ์บัตรสต็อก"
                  className="press-spring"
                  style={{ flex: 1, width: 54, border: '1px solid var(--border)', background: 'var(--bg-card)', color: viewRows ? 'var(--ink)' : 'var(--muted)', borderRadius: 10, fontSize: 19 }}
                >
                  🖨
                </button>
                <button
                  onClick={exportCard}
                  disabled={!viewRows}
                  title="ดาวน์โหลดเป็น CSV"
                  aria-label="ดาวน์โหลดเป็น CSV"
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
              // Bug fix: this used to hardcode either 2 or 3 columns based on whether ANY one
              // of the two optional tiles (ตัดหมดอายุ, ปรับยอดจากนับสต็อก) was showing — true for
              // a med with both an expired-lot scrap AND a substock count adjustment in the same
              // fiscal year (an entirely ordinary combination, not a rare edge case), which then
              // renders 4 SummaryTiles into a 3-column grid: the 4th tile wraps onto its own row
              // alone at 1/3 width instead of lining up with the other three. Count the tiles
              // that will actually render and size the grid to that, so any combination (2, 3,
              // or 4 tiles) always fills its row evenly.
              <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: `repeat(${2 + (yearTotals.expired > 0 ? 1 : 0) + (yearTotals.counted !== 0 ? 1 : 0)}, 1fr)`, gap: 8 }}>
                <SummaryTile label="รับเข้ารวม" value={yearTotals.received} unit={med.unit} color="var(--green)" />
                <SummaryTile label="เติมหน้างานรวม" value={yearTotals.dispensed} unit={med.unit} color="var(--red)" />
                {yearTotals.expired > 0 && <SummaryTile label="ตัดหมดอายุรวม" value={yearTotals.expired} unit={med.unit} color="var(--amber-ink)" />}
                {yearTotals.counted !== 0 && <SummaryTile label="ปรับยอดจากนับสต็อก" value={yearTotals.counted} unit={med.unit} color={yearTotals.counted > 0 ? 'var(--green)' : 'var(--red)'} />}
              </div>
            )}
            {mismatch && (
              <div style={{ fontSize: 11, color: 'var(--amber-ink)', background: 'var(--amber-bg)', padding: '9px 14px', lineHeight: 1.5, borderTop: '1px solid var(--amber-border)', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                <span style={{ flex: 1 }}>
                  {hasNameTwin
                    ? `ยานี้มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน — ยอดจากประวัติ (${nf(lastLedgerBalance)} ${med.unit}) อาจไม่ครบตั้งแต่ก่อนระบบแยกประวัติตาม ward ได้ ยอดคงเหลือจริงด้านบนยังถูกต้องเสมอ`
                    : `ยอดจากประวัติธุรกรรม (${nf(lastLedgerBalance)} ${med.unit}) ไม่ตรงกับยอดจริงตอนนี้ — อาจมีการปรับยอดนอกช่องทางปกติ ลองตรวจสอบใน Audit log`}
                </span>
                {/* Was just an instruction to "go check the Audit log" with no way to actually
                    get there — only wired up for role==='admin' since AdminScreen's user/audit
                    data (state.users, etc.) is only ever subscribed for that role; sending a
                    pharm/tech there would land on a broken/empty screen instead of helping. */}
                {!hasNameTwin && state.role === 'admin' && (
                  <button
                    onClick={() => { setAuditFilter('stock'); setAdminTab('audit'); go('admin'); }}
                    className="press-spring"
                    style={{ flex: 'none', border: '1px solid var(--amber)', background: 'rgba(255,255,255,.5)', color: 'var(--amber-ink)', padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}
                  >
                    ไปดู Audit log →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Type-icon legend — the ledger table below packs each row's type into a single
              icon (📥🚚🗑️🔢) to keep the grid narrow enough for a phone screen; the only place
              their meaning used to live was each row's `title` attribute, which needs a mouse
              hover that a touchscreen never provides. Spelled out once, plainly, here. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '9px 13px', background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)', borderRadius: 12, marginBottom: 12 }}>
            {Object.values(TYPE_META).map((t) => (
              <span key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <span aria-hidden="true">{t.icon}</span>
                <span className="muted">{t.label}</span>
              </span>
            ))}
          </div>

          {loading && <SkeletonList rows={5} />}

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
                <EmptyState
                  icon="🗂️"
                  title={rows && rows.length > 0 ? 'ไม่มีประวัติ substock ใน' + (year === 'all' ? 'ช่วงนี้' : 'ปีงบ ' + year) : 'ยานี้ยังไม่มีประวัติ substock'}
                  sub={rows && rows.length > 0 ? 'ลองสลับดูปีงบอื่น หรือเลือก "ทุกปี"' : 'จะเริ่มมีประวัติทันทีที่รับเข้า/เติมหน้างาน/ตัดหมดอายุยานี้ครั้งแรก'}
                />
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
