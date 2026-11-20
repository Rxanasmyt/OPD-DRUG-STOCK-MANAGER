// Keeps the manual in step with the app: tab/menu names come from one place, every screen is mapped to a manual
// section that exists, and the manual never hard-codes a tab name that isn't a real one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { TAB, MENU, SCREEN_MANUAL } from './navLabels';
import UserManual, { MANUAL_SECTIONS } from './screens/UserManual';
import { DAILY_STEPS, PERIODIC_STEP } from './screens/LoginGuide';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('manual ↔ app consistency', () => {
  it('bottom nav and the เพิ่มเติม menu are built from navLabels (no private copies of the names)', () => {
    const app = src('./App.tsx');
    for (const k of Object.keys(TAB)) expect(app).toContain('TAB.' + k);
    const more = src('./screens/MoreScreen.tsx');
    for (const k of ['adjust', 'count', 'meds', 'wardmove', 'par', 'report', 'substockcard', 'labels', 'admin']) expect(more).toContain('MENU.' + k);
  });

  it('every screen points at a manual section that exists', () => {
    const ids = new Set(MANUAL_SECTIONS.map((s) => s.id));
    for (const [screen, id] of Object.entries(SCREEN_MANUAL)) if (id !== null) expect(ids.has(id), screen + ' → ' + id).toBe(true);
  });

  it('every highlighted tab/menu name in the manual is a real one', () => {
    const { container } = render(<UserManual onClose={() => {}} />);
    const real = new Set<string>([...Object.values(TAB), ...Object.values(MENU)]);
    const tabs = Array.from(container.querySelectorAll('.um-tab')).map((e) => e.textContent ?? '');
    expect(tabs.length).toBeGreaterThan(8);
    for (const t of tabs) expect(real.has(t), '"' + t + '" is not a tab/menu name').toBe(true);
  });

  it('login guide steps quote the real tab names', () => {
    for (const s of [...DAILY_STEPS, PERIODIC_STEP]) expect(Object.values(TAB).some((t) => s.where.includes(t)), s.where).toBe(true);
  });
});
