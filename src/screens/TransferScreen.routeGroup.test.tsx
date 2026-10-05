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
const UNCLASSIFIED = {
  id: 'm3', code: 'MED-0003', name: 'Hydrocortisone Cream', unit: 'Tube', dosageForm: 'Cream',
  price: 1, had: false, active: true, parSub: 20, parFloor: 10, floor: 1, bin: 'C3',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — oral/injection route grouping regression', () => {
  it('groups oral rows and injection rows under separate headers, never interleaved', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [ORAL, INJECTION, UNCLASSIFIED]);
    fireCollection('lots', []);

    await screen.findByText(ORAL.name);
    expect(screen.getByText(/💊 ยากิน/)).toBeInTheDocument();
    expect(screen.getByText(/💉 ยาฉีด/)).toBeInTheDocument();
    // Route group's "unclassified" header text ("...ยังไม่ระบุประเภท") is distinct from the
    // unrelated category filter's own "อื่นๆ / ยังไม่ระบุหมวด" chip, which can also appear on
    // screen for the same unclassified med — match the full, unique route-group label only.
    expect(screen.getByText(/📦 อื่นๆ \/ ยังไม่ระบุประเภท/)).toBeInTheDocument();

    // Oral group's own header must appear before the injection row's name in document order,
    // and the injection header before the unclassified row's name — i.e. groups stay intact
    // rather than interleaved by whatever `sort` would otherwise produce.
    const html = document.body.innerHTML;
    const unclassifiedHeaderIdx = html.indexOf('ยังไม่ระบุประเภท');
    expect(html.indexOf('ยากิน')).toBeLessThan(html.indexOf(ORAL.name));
    expect(html.indexOf(ORAL.name)).toBeLessThan(html.indexOf('ยาฉีด'));
    expect(html.indexOf('ยาฉีด')).toBeLessThan(html.indexOf(INJECTION.name));
    expect(html.indexOf(INJECTION.name)).toBeLessThan(unclassifiedHeaderIdx);
    expect(unclassifiedHeaderIdx).toBeLessThan(html.indexOf(UNCLASSIFIED.name));
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
});
