import { useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { usesSubstock, needsWarehouseRequest, subTone, daysOfStockLeft } from '../store/selectors';
import { nf, thDate, thTime } from '../utils/format';
import { MedDot } from '../components/MedDot';
import { Qty, DaysLeftBadge } from '../components/Qty';
import { WardBadge } from '../components/WardBadge';
import { StepIndicator, RECEIVE_STEPS } from '../components/StepIndicator';
import { SearchInput } from '../components/SearchInput';
import type { Med } from '../types';

// The "ควรเบิกจากคลังใหญ่" sort order — a noSubstock med has no substock stage to rank by (see
// needsReceive's doc comment below), so its floor/parFloor ratio stands in for it there.
function needsReceiveRatio(m: Med, curSub: number): number {
  return usesSubstock(m) ? curSub / Math.max(1, m.parSub) : m.floor / Math.max(1, m.parFloor);
}

export default function ReceiveScreen() {
  const {
    state, sub, setRecvNo, setRecvSearch, pickRecvMed,
    removeRecvItem, commitReceive, approvePendingReceive, rejectPendingReceive, openScanSearch,
    printWarehouseRequestList, promptAsync, goSubstockCardFor,
  } = useApp();
  // Real-world request: "ให้ทุกหน้าที่แสดงชื่อยาจำนวนยา...ให้สามารถดูบัตรสต็อคได้" — every med
  // row on this screen used to be action-only (pick it to receive / remove it / approve/reject
  // it), with zero way to peek at that drug's real substock history BEFORE committing to a
  // receipt for it (a real, useful check before typing a lot/exp/qty for a drug someone isn't
  // 100% sure about). Two different affordances, since the rows themselves aren't one shape:
  // - stopRowNav(fn): for a row that's a plain (non-button) div ALREADY wrapped with its own
  //   goSubstockCardFor onClick (see rowToCard below) — stops a tap on a nested action button
  //   (approve/reject/ลบ) from also navigating away, same pattern as HomeScreen's own rows.
  // - CardPeekButton: for a row that's itself the PRIMARY action (tapping it picks the drug for
  //   receiving — pickRecvMed) — can't repurpose the whole row for navigation without breaking
  //   that, so this adds a small, separate, stopPropagation'd icon button instead.
  const rowToCard = (medId: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => goSubstockCardFor(medId),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goSubstockCardFor(medId); } },
    title: 'ดูบัตรสต็อกยานี้',
  });
  const stopRowNav = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  // OPD/IPD ward tabs removed — one combined picker across the whole formulary.
  const options = !state.recvMed && state.recvSearch.trim()
    ? state.meds.filter((m) => { const s = state.recvSearch.trim().toLowerCase(); return m.active && (m.name.toLowerCase().indexOf(s) >= 0 || m.code.toLowerCase().indexOf(s) >= 0); }).slice(0, 12)
    : [];
  // Bug fix: this screen used to show NOTHING until someone typed a search — a person opening
  // "รับเข้า" to see what actually needs requisitioning from the central warehouse had no way
  // to find out except typing each drug's name from memory one at a time. Same "ควรเบิกจากคลัง
  // ใหญ่" list HomeScreen already computes (substock below its par), shown here by default —
  // most urgent (lowest substock/par ratio) first — and it steps aside the moment a search is
  // typed or a med is picked, so it never competes with the actual search results above.
  //
  // Bug fix (follow-up): only ever checked usesSubstock(m) meds against substock/parSub — a
  // noSubstock med (liquids/inhalers/sprays, see usesSubstock()) has no substock stage, but it
  // IS refilled straight from this exact central-warehouse request on the exact same 2-week
  // cycle (see the "รอบ 2 สัปดาห์" print button above), and its floor par is already sized off
  // that same 2-week basis (suggestPar(), selectors.ts) — so it was silently never showing up
  // here even when its shelf genuinely needed requesting. Judge it against floor/parFloor
  // instead (its shelf IS its substock for this purpose); a substock-backed med is judged
  // against substock/parSub as before — every active med falls into exactly one check.
  // Bug fix (undercount): the header ("ควรเบิกจากคลังใหญ่ (N)") and this list used to read the
  // SAME N off the already-`.slice(0, 20)`'d array — with more than 20 real meds below their
  // central-warehouse-request threshold (an ordinary busy day, not a rare edge case), the header
  // silently showed only 20 instead of the true total, with nothing on screen hinting more
  // existed (every other capped list in this screen family — CountScreen's "แสดง 150 รายการแรก"
  // — already discloses its own cap; this one just didn't). Compute the real total first, slice
  // only for what actually renders, and expose both.
  const needsReceiveAll = !state.recvMed && !state.recvSearch.trim()
    ? state.meds
        .filter((m) => m.active && needsWarehouseRequest(m, sub(m.id)))
        .sort((a, b) => needsReceiveRatio(a, sub(a.id)) - needsReceiveRatio(b, sub(b.id)))
    : [];
  const needsReceive = needsReceiveAll.slice(0, 20);
  // "ล่าสุด" quick-pick chips — same idea as TransferScreen's (see its own doc comment): the
  // handful of drugs actually received most delivery days shouldn't need typing their name
  // every time. Still can't skip the lot/exp/qty entry itself (nothing on a shelf label can
  // supply those for a NEW lot — this only saves the search-and-tap step), but for a big
  // delivery with the same recurring items, cutting that step for each one adds up.
  const recentMeds = useMemo(() => {
    if (state.recvSearch.trim() || state.recvMed) return [];
    const seen = new Set<string>();
    const out: Med[] = [];
    for (const t of state.txs) {
      if (t.type !== 'receive_from_central' || !t.medId || seen.has(t.medId)) continue;
      seen.add(t.medId);
      const m = state.meds.find((x) => x.id === t.medId && x.active);
      if (m) out.push(m);
      if (out.length >= 8) break;
    }
    return out;
  }, [state.txs, state.meds, state.recvSearch, state.recvMed]);

  // Bug fix (flow friction / mistake risk): the quick-pick lists below (recentMeds, options,
  // needsReceive) never showed whether a drug was already added to THIS in-progress, not-yet-
  // committed receipt (state.recvItems) — genuinely ambiguous mid-delivery when working through
  // several items in a row, with a real risk of tapping the same drug again and double-entering
  // its lot/qty by mistake. A badge (not a disable — a real delivery can legitimately have two
  // different lots of the same drug arrive together, so re-picking it must still be possible)
  // closes the ambiguity without removing that case.
  const recvItemCountByMed = useMemo(() => {
    const counts: Record<string, number> = {};
    state.recvItems.forEach((it) => { counts[it.medId] = (counts[it.medId] || 0) + 1; });
    return counts;
  }, [state.recvItems]);

  const canApprove = state.role !== 'tech';
  const pending = state.pendingReceives.filter((r) => r.status === 'pending');
  const myPending = pending.filter((r) => r.requestedByUid === state.myUid);

  return (
    <div style={{ animation: 'fade .18s' }}>
      <StepIndicator steps={RECEIVE_STEPS} current={0} />
      <div style={{ padding: '10px 14px 24px' }}>
      <button
        onClick={printWarehouseRequestList}
        className="btn-outline"
        style={{ width: '100%', padding: 12, borderRadius: 11, fontSize: 13.5, fontWeight: 600, minHeight: 46, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        🖨 พิมพ์ใบขอเบิกจากคลังใหญ่ — รอบ 2 สัปดาห์
      </button>

      {(canApprove ? pending.length > 0 : myPending.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px', color: 'var(--amber-ink)' }}>
            {canApprove ? `รออนุมัติ (${pending.length})` : `คำขอของคุณที่ยังรออนุมัติ (${myPending.length})`}
          </div>
          <div className="card stagger" style={{ overflow: 'hidden', borderColor: 'var(--amber)' }}>
            {(canApprove ? pending : myPending).map((r) => {
              const rMed = state.meds.find((m) => m.id === r.medId);
              return (
              <div key={r.id} className="row-interactive" {...rowToCard(r.medId)} style={{ padding: '11px 13px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>{r.name} {rMed && <WardBadge med={rMed} />}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--green)', flex: 'none' }}>{nf(r.qty)} {r.unit}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
                  ใบเบิก {r.recvNo} · lot {r.lotNo} · exp {thDate(r.exp)} · ขอโดย {r.requestedBy} เมื่อ {thDate(r.ts)} {thTime(r.ts)}
                </div>
                {canApprove ? (() => {
                  const rowBusy = !!state.busy[`approveReceive:${r.id}`] || !!state.busy[`rejectReceive:${r.id}`];
                  return (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={stopRowNav(() => approvePendingReceive(r.id))} disabled={rowBusy} className="btn-primary" style={{ flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, minHeight: 44, opacity: rowBusy ? 0.7 : 1 }}>
                      {state.busy[`approveReceive:${r.id}`] ? 'กำลังบันทึก…' : 'อนุมัติ'}
                    </button>
                    <button
                      onClick={stopRowNav(async () => { const reason = await promptAsync('เหตุผลที่ปฏิเสธ (จะบันทึกลง audit log)'); if (reason !== null) rejectPendingReceive(r.id, reason.trim()); })}
                      disabled={rowBusy}
                      style={{ flex: 1, border: '1px solid var(--red)', background: 'var(--bg-card)', color: 'var(--red)', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, minHeight: 44, opacity: rowBusy ? 0.7 : 1 }}
                    >
                      {state.busy[`rejectReceive:${r.id}`] ? 'กำลังบันทึก…' : 'ปฏิเสธ'}
                    </button>
                  </div>
                  );
                })() : (
                  <div style={{ fontSize: 11.5, color: 'var(--amber-ink)', marginTop: 6, fontWeight: 600 }}>รอเภสัชกร/แอดมินอนุมัติ</div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>เลขที่ใบเบิก</span>
          <input value={state.recvNo} onChange={(e) => setRecvNo(e.target.value)} style={inputStyle} />
        </label>
        <label>
          <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>วันที่รับ</span>
          <input value={new Date().toISOString().slice(0, 10)} type="date" readOnly style={inputStyle} />
        </label>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>เพิ่มรายการ</div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 9 }}>สแกน QR ที่ติดหน้ายาใน substock เพื่อระบุตัวยาอัตโนมัติ หรือค้นหาด้วยชื่อ</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <SearchInput
            value={state.recvSearch}
            onChange={setRecvSearch}
            placeholder="ค้นหา / สแกนชื่อยา"
            style={{ flex: 1, minWidth: 0 }}
            onEnter={options.length === 1 ? () => pickRecvMed(options[0].id) : undefined}
          />
          <button onClick={() => openScanSearch('receive')} title="สแกน QR รับเข้า substock" aria-label="สแกน QR รับเข้า substock" style={{ border: '1px solid var(--amber)', background: 'var(--amber-bg)', color: 'var(--amber-ink)', borderRadius: 10, width: 46, minHeight: 44, fontSize: 17, flex: 'none' }}>▣</button>
        </div>

        {recentMeds.length > 0 && (
          <div style={{ display: 'flex', gap: 7, marginBottom: 9, overflowX: 'auto', paddingBottom: 2 }}>
            <span className="muted" style={{ fontSize: 11, flex: 'none', alignSelf: 'center', paddingRight: 2 }}>ล่าสุด:</span>
            {recentMeds.map((m) => (
              <button
                key={m.id}
                onClick={() => pickRecvMed(m.id)}
                className="chip press-spring"
                style={{ border: '1px solid var(--amber)', background: 'var(--amber-bg)', color: 'var(--amber-ink)', flex: 'none' }}
                title={'เลือก ' + m.name}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        {options.length > 0 && (
          <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 172, overflowY: 'auto', marginBottom: 9 }}>
            {options.map((m) => (
              // A plain <div role="button"> (not a real <button>) — picking this med to receive
              // is still this row's own primary action (onClick below), but a real <button>
              // can't contain the nested CardPeekButton <button> (invalid, un-clickable HTML).
              <div key={m.id} role="button" tabIndex={0} onClick={() => pickRecvMed(m.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRecvMed(m.id); } }} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 8px 10px 12px', minHeight: 44, cursor: 'pointer' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <MedDot code={m.code} /> {m.name} <WardBadge med={m} />
                    {recvItemCountByMed[m.id] > 0 && <span className="muted" style={{ fontSize: 11 }}>· เพิ่มแล้ว {recvItemCountByMed[m.id]} lot</span>}
                  </span>
                  {/* Bug fix (misleading number): this used to show "substock 0 · par N" for a
                      noSubstock med unconditionally — a real number since noSubstock meds never
                      get lots (sub(m.id) is always 0), reading as a critical shortage in a stage
                      that doesn't exist for that drug at all. The "ควรเบิกจากคลังใหญ่" list below
                      already branches on usesSubstock() correctly for this exact reason (see its
                      own comment) — this search-result list just never got the same fix, so
                      which of the two paths someone used to reach the same drug decided which
                      (correct or misleading) number they saw. */}
                  {usesSubstock(m) ? (
                    <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>substock <Qty value={sub(m.id)} tone={subTone(sub(m.id), m.parSub)} size={11.5} /> · par {nf(m.parSub)}</span>
                  ) : (
                    <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>ไม่มี substock · หน้างาน <Qty value={m.floor} tone={subTone(m.floor, m.parFloor)} size={11.5} /> · par {nf(m.parFloor)}</span>
                  )}
                  <div style={{ marginTop: 3 }}><DaysLeftBadge days={daysOfStockLeft(state, m)} /></div>
                </div>
                <CardPeekButton medId={m.id} name={m.name} onOpen={goSubstockCardFor} />
              </div>
            ))}
          </div>
        )}

        {needsReceiveAll.length > 0 && (
          <div style={{ marginBottom: 9 }}>
            <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, margin: '2px 2px 6px' }}>ควรเบิกจากคลังใหญ่ ({needsReceiveAll.length})</div>
            {needsReceiveAll.length > needsReceive.length && (
              <div className="muted" style={{ fontSize: 11, margin: '0 2px 6px' }}>แสดง {needsReceive.length} จาก {needsReceiveAll.length} รายการ — ค้นหาชื่อยาด้านบนเพื่อดูรายการอื่น</div>
            )}
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 260, overflowY: 'auto' }}>
              {needsReceive.map((m) => (
                <div key={m.id} role="button" tabIndex={0} onClick={() => pickRecvMed(m.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRecvMed(m.id); } }} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 8px 10px 12px', minHeight: 44, cursor: 'pointer' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <MedDot code={m.code} /> {m.name} <WardBadge med={m} />
                      {recvItemCountByMed[m.id] > 0 && <span className="muted" style={{ fontSize: 11 }}>· เพิ่มแล้ว {recvItemCountByMed[m.id]} lot</span>}
                    </span>
                    {/* A noSubstock med has no real substock number to show (always 0) — its
                        shelf (floor/parFloor) IS the number that matters for "should this be on
                        the warehouse request" here, so show that instead — see needsReceive's
                        doc comment above for why it's judged the same way. */}
                    {usesSubstock(m) ? (
                      <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>substock <Qty value={sub(m.id)} tone={subTone(sub(m.id), m.parSub)} size={11.5} /> · par {nf(m.parSub)}</span>
                    ) : (
                      <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>ไม่มี substock · หน้างาน <Qty value={m.floor} tone={subTone(m.floor, m.parFloor)} size={11.5} /> · par {nf(m.parFloor)}</span>
                    )}
                    <div style={{ marginTop: 3 }}><DaysLeftBadge days={daysOfStockLeft(state, m)} /></div>
                  </div>
                  <CardPeekButton medId={m.id} name={m.name} onOpen={goSubstockCardFor} />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {state.recvItems.length > 0 && (
        <>
          <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 12 }}>
            {state.recvItems.map((it, i) => {
              const itMed = state.meds.find((m) => m.id === it.medId);
              return (
                <div key={i} className="row-interactive" {...rowToCard(it.medId)} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>{it.name} {itMed && <WardBadge med={itMed} />}</div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>lot {it.lotNo} · exp {thDate(it.exp)} · {nf(it.qty)} {it.unit}</div>
                  </div>
                  <button onClick={stopRowNav(() => removeRecvItem(i))} style={{ border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12.5, flex: 'none' }}>ลบ</button>
                </div>
              );
            })}
          </div>
          {/* Real-world request: every role now receives directly (short-staffed right now —
              see commitReceive's `approve` in AppContext.tsx, always true) — the tech-specific
              "ส่งให้เภสัชกรอนุมัติ" branch this used to have is gone; canApprove above still
              gates the "รออนุมัติ" list further up this screen, for any request left over from
              before this change. */}
          <button onClick={commitReceive} disabled={!!state.busy['receive']} className="btn-primary" style={{ width: '100%', padding: 16, borderRadius: 12, fontSize: 16, minHeight: 54, opacity: state.busy['receive'] ? 0.7 : 1 }}>
            {state.busy['receive'] ? 'กำลังบันทึก…' : 'รับเข้า substock'}
          </button>
        </>
      )}
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
// Bug fix (mobile fit): a font-size under 16px on a real text input makes iOS Safari auto-
// zoom the whole page in on focus (it assumes the text needs magnifying) — every field on
// this screen (lot no., expiry, qty, ใบเบิก no.) went through this const at 14px, so tapping
// any of them mid-receive zoomed the layout out of "fits the screen" until tapping away again.
const inputStyle: CSSProperties = { width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 16, minHeight: 44 };

// Small, separate "view stock card" affordance for a row whose own tap already does something
// else (picking the drug for receiving) — see ReceiveScreen's own "Real-world request" comment
// on rowToCard/stopRowNav above for why this can't just be the whole row like HomeScreen's own
// rows. stopPropagation is baked in here (not left to each call site) since every call site
// needs it for the same reason: this button always sits inside a row that has its own onClick.
function CardPeekButton({ medId, name, onOpen }: { medId: string; name: string; onOpen: (medId: string) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(medId); }}
      title={'ดูบัตรสต็อก ' + name}
      aria-label={'ดูบัตรสต็อก ' + name}
      // Bug fix (usability): 30px was noticeably under this app's own ~44px tap-target
      // convention (every other button on this screen — rows, chips, approve/reject — is 44px+)
      // — a real mis-tap risk on a tablet used one-handed in a hurry, right next to a full-row
      // tap target with a different action (pickRecvMed).
      style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--green)', fontSize: 18, padding: '4px 6px', minWidth: 44, minHeight: 44 }}
    >
      📋
    </button>
  );
}
