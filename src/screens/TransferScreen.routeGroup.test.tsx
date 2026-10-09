// Regression test for a real request: "ยาที่ต้องเติมหน้างานให้แยกยากินกับยาฉีดให้หน่อยครับ เพื่อ
// ง่ายต่อการเบิกยาจริงหน้างาน เพื่อไม่ให้ความสับสนในการทำงาน" — route grouping must be the PRIMARY
// ordering (oral rows never interleaved with injection rows), with a header shown for each group
// only when there's more than one to tell apart, so a filtered view with just one route never
// shows a single redundant header. See TransferScreen.tsx's own "Real-world request" comment on
// visibleRows/routeGroups.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const ORAL = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0, route: 'oral' as const,
};
const INJECTION = {
  id: 'm2', code: 'MED-0002', name: 'Adrenaline 1mg/mL', unit: 'Amp', dosageForm: 'Injection',
  price: 1, had: false, active: true, parSub: 50, parFloor: 20, floor: 2, bin: 'B2',
  used30: 0, usedPrev30: 0, volatility: 0, route: 'injection' as const,
};
// Real-world request (this round): "ยังไม่มียาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — a
// cream now confidently groups under its own "🧴 ยาทาภายนอก" bucket instead of falling into the
// generic "อื่นๆ / ยังไม่ระบุประเภท" one.
const UNCLASSIFIED_TOPICAL = {
  id: 'm3', code: 'MED-0003', name: 'Hydrocortisone Cream', unit: 'Tube', dosageForm: 'Cream',
  price: 1, had: false, active: true, parSub: 20, parFloor: 10, floor: 1, bin: 'C3',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// "SOLUTIONS" alone is genuinely ambiguous (see routeSuggest.ts's own comment) — still the real
// case that correctly falls into the generic "อื่นๆ" bucket.
const UNCLASSIFIED_OTHER = {
  id: 'm3b', code: 'MED-0003B', name: 'Normal Saline Solution', unit: 'Bag', dosageForm: 'Solution',
  price: 1, had: false, active: true, parSub: 20, parFloor: 10, floor: 1, bin: 'C4',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// No explicit `route` at all — the real-world state of the ENTIRE formulary the moment this
// feature shipped (see effectiveRouteOf()'s own doc comment for the friction report this fixed).
const ORAL_NO_ROUTE_SET = {
  id: 'm4', code: 'MED-0004', name: 'Amoxicillin 250mg', unit: 'แคปซูล', dosageForm: 'แคปซูล',
  price: 1, had: false, active: true, parSub: 300, parFloor: 60, floor: 5, bin: 'A4',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const INJECTION_NO_ROUTE_SET = {
  id: 'm5', code: 'MED-0005', name: 'Cefazolin 1g', unit: 'Vial', dosageForm: '',
  price: 1, had: false, active: true, parSub: 60, parFloor: 20, floor: 3, bin: 'B5',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — oral/injection route grouping regression', () => {
  it('groups oral, injection, topical and unclassified rows under separate headers, never interleaved', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [ORAL, INJECTION, UNCLASSIFIED_TOPICAL, UNCLASSIFIED_OTHER]);
    fireCollection('lots', []);

    await screen.findByText(ORAL.name);
    expect(screen.getByText(/💊 ยากิน/)).toBeInTheDocument();
    expect(screen.getByText(/💉 ยาฉีด/)).toBeInTheDocument();
    expect(screen.getByText(/🧴 ยาทาภายนอก/)).toBeInTheDocument();
    // Route group's "unclassified" header text ("...ยังไม่ระบุประเภท") is distinct from the
    // unrelated category filter's own "อื่นๆ / ยังไม่ระบุหมวด" chip, which can also appear on
    // screen for the same unclassified med — match the full, unique route-group label only.
    expect(screen.getByText(/📦 อื่นๆ \/ ยังไม่ระบุประเภท/)).toBeInTheDocument();

    // Each group's own header must appear before its rows' names, in ROUTES order (see
    // data/routes.ts) — i.e. groups stay intact rather than interleaved by whatever `sort`
    // would otherwise produce.
    const html = document.body.innerHTML;
    const topicalHeaderIdx = html.indexOf('ยาทาภายนอก');
    const unclassifiedHeaderIdx = html.indexOf('ยังไม่ระบุประเภท');
    expect(html.indexOf('ยากิน')).toBeLessThan(html.indexOf(ORAL.name));
    expect(html.indexOf(ORAL.name)).toBeLessThan(html.indexOf('ยาฉีด'));
    expect(html.indexOf('ยาฉีด')).toBeLessThan(html.indexOf(INJECTION.name));
    expect(html.indexOf(INJECTION.name)).toBeLessThan(topicalHeaderIdx);
    expect(topicalHeaderIdx).toBeLessThan(html.indexOf(UNCLASSIFIED_TOPICAL.name));
    expect(html.indexOf(UNCLASSIFIED_TOPICAL.name)).toBeLessThan(unclassifiedHeaderIdx);
    expect(unclassifiedHeaderIdx).toBeLessThan(html.indexOf(UNCLASSIFIED_OTHER.name));
  });

  it('suppresses every group header when the filtered view contains only one route', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [INJECTION]);
    fireCollection('lots', []);

    await screen.findByText(INJECTION.name);
    expect(screen.queryByText(/💉 ยาฉีด/)).not.toBeInTheDocument();
  });

  it('groups meds with NO explicit route set at all, purely from name/unit, the moment they are added', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [ORAL_NO_ROUTE_SET, INJECTION_NO_ROUTE_SET]);
    fireCollection('lots', []);

    await screen.findByText(ORAL_NO_ROUTE_SET.name);
    expect(screen.getByText(/💊 ยากิน/)).toBeInTheDocument();
    expect(screen.getByText(/💉 ยาฉีด/)).toBeInTheDocument();
    const html = document.body.innerHTML;
    expect(html.indexOf('ยากิน')).toBeLessThan(html.indexOf(ORAL_NO_ROUTE_SET.name));
    expect(html.indexOf(ORAL_NO_ROUTE_SET.name)).toBeLessThan(html.indexOf('ยาฉีด'));
    expect(html.indexOf('ยาฉีด')).toBeLessThan(html.indexOf(INJECTION_NO_ROUTE_SET.name));
  });
});
