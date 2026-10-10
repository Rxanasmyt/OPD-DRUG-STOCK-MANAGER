// Regression test for a real visual bug found by actually rendering the Report tab's
// "มูลค่าการใช้ยาแยกตามหมวด" chart (real-device UX audit, "ตรวจดูหน้ารายงาน/กราฟว่ายังมีจุดไหน
// ต้องปรับอีกไหม"): recharts' default category-axis tick has no word-wrap and no truncation —
// a label longer than the axis's given width just overflows past it and gets clipped by the
// chart's own edge. A Y-axis tick's text-anchor sits at its RIGHT edge (growing leftward), so
// what got clipped was the START of the label — "ยาเบาหวาน/ต่อมไร้ท่อ/ไขมันในเลือด" rendered as
// "หวาน/ต่อมไร้ท่อ/ไขมันในเลือด", silently dropping which drug class "เบา-" even was. See
// UsageCharts.tsx's own "Bug fix" comment.
import { describe, it, expect } from 'vitest';
import { truncateLabel } from './UsageCharts';
import { categoryLabel } from '../data/categories';

describe('UsageCharts — category-axis label truncation regression', () => {
  it('leaves a short label untouched', () => {
    expect(truncateLabel('ยาตา/หู/คอ/จมูก', 16)).toBe('ยาตา/หู/คอ/จมูก');
  });

  it('truncates a long label with an ellipsis instead of letting it overflow uncut', () => {
    const result = truncateLabel('ยาเบาหวาน/ต่อมไร้ท่อ/ไขมันในเลือด', 16);
    expect(result.length).toBe(16);
    expect(result.endsWith('…')).toBe(true);
  });

  it('keeps the START of the real endocrine category label intact — the part a Y-axis tick clip would have dropped first', () => {
    // Without the fix, the chart showed "หวาน/ต่อมไร้ท่อ/ไขมันในเลือด" (missing "ยาเบา") because
    // the raw, untruncated label overflowed recharts' YAxis width and got clipped from its start.
    const real = categoryLabel('endocrine');
    const truncated = truncateLabel(real, 16);
    expect(truncated.startsWith('ยาเบาหวาน')).toBe(true);
  });
});
