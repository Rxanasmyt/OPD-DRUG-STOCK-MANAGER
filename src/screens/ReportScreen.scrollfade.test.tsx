// Regression for a UI-polish finding from an actual screenshot review (real-world request:
// "หน้ารายงาน...ยังไม่สวยเลย" — rendered the screen with sample data and looked at it): the
// report-tab strip has 10 tabs but only ~3 fit on a phone-width screen, and used to end in a
// hard, unsignaled cut edge — nothing told a reader "ยอดคงคลังย้อนหลัง"/"รายงานคืนยา" (tabs 9-10)
// even exist. See styles.css's own ".scroll-fade-x" comment for the fix (an edge fade mask).
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

describe('ReportScreen — horizontal scroll-fade regression', () => {
  it('marks the report-tab strip as scroll-fade-x, so the overflow edge is never a hard unsignaled cut', async () => {
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    const firstTab = await screen.findByRole('button', { name: /ภาพรวมผู้บริหาร/ });
    expect(firstTab.parentElement).toHaveClass('scroll-fade-x');
  });
});
