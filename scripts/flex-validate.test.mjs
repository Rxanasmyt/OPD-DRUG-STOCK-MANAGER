// Structural check of every Flex message the notifiers can produce, against LINE's documented rules (a rejected message =
// nothing reaches the group). The rules below are the ones a typo or an over-long label would break. Not a full schema.
import { describe, it, expect } from 'vitest';
import { buildReport, buildFlex } from './notify-low-stock.mjs';
import { buildMonthlyReport, buildMonthlyFlex, REVERSAL_PREFIX } from './notify-monthly-returns.mjs';
import { reminderMessage } from './notify-hosxp-missing.mjs';
import { buildAlert } from './notify-alert.mjs';
import { alertFlex } from './moph-notify.mjs';

const KW = ['none', 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', '3xl', '4xl', '5xl'];
const LEN = /^(\d+(\.\d+)?(px|%))$/;
const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const okLen = (v) => KW.includes(v) || LEN.test(v);
const bad = [];
const err = (path, msg) => bad.push(path + ': ' + msg);

function box(n, path) {
  if (!['horizontal', 'vertical', 'baseline'].includes(n.layout)) err(path, 'layout ' + n.layout);
  if (!Array.isArray(n.contents) || n.contents.length === 0) err(path, 'box needs non-empty contents');
  for (const k of ['margin', 'spacing', 'paddingAll', 'paddingStart', 'paddingEnd', 'paddingTop', 'paddingBottom', 'cornerRadius', 'width', 'height']) if (k in n && !okLen(n[k])) err(path, `${k}=${n[k]}`);
  if ('flex' in n && !Number.isInteger(n.flex)) err(path, 'flex');
  if ('backgroundColor' in n && !HEX.test(n.backgroundColor)) err(path, 'backgroundColor ' + n.backgroundColor);
  if ('alignItems' in n && !['flex-start', 'center', 'flex-end'].includes(n.alignItems)) err(path, 'alignItems');
  if ('justifyContent' in n && !['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].includes(n.justifyContent)) err(path, 'justifyContent');
  if (n.background) {
    const g = n.background;
    if (g.type !== 'linearGradient' || !/^\d+deg$/.test(g.angle) || !HEX.test(g.startColor) || !HEX.test(g.endColor)) err(path, 'bad gradient');
  }
  (n.contents || []).forEach((c, i) => node(c, `${path}.contents[${i}]`));
}
function node(n, path) {
  switch (n.type) {
    case 'box': return box(n, path);
    case 'filler': return;
    case 'separator': return;
    case 'text':
      if (typeof n.text !== 'string' || !n.text.length) err(path, 'text must be a non-empty string');
      if ('size' in n && !okLen(n.size)) err(path, 'size ' + n.size);
      if ('weight' in n && !['regular', 'bold'].includes(n.weight)) err(path, 'weight');
      if ('align' in n && !['start', 'end', 'center'].includes(n.align)) err(path, 'align');
      if ('gravity' in n && !['top', 'bottom', 'center'].includes(n.gravity)) err(path, 'gravity');
      if ('color' in n && !HEX.test(n.color)) err(path, 'color ' + n.color);
      if ('wrap' in n && typeof n.wrap !== 'boolean') err(path, 'wrap');
      if ('adjustMode' in n && n.adjustMode !== 'shrink-to-fit') err(path, 'adjustMode');
      if ('margin' in n && !okLen(n.margin)) err(path, 'margin');
      return;
    case 'button': {
      if (!['link', 'primary', 'secondary'].includes(n.style)) err(path, 'style');
      const a = n.action || {};
      if (a.type !== 'uri' || !/^https:\/\//.test(a.uri || '') || a.uri.length > 1000) err(path, 'uri action must be https and <= 1000 chars');
      if (!a.label || a.label.length > 20) err(path, `action label must be 1-20 chars (got ${a.label?.length}: "${a.label}")`);
      return;
    }
    default: err(path, 'unknown node type ' + n.type);
  }
}
function bubble(b, path) {
  if (b.type !== 'bubble') err(path, 'not a bubble');
  if ('size' in b && !['nano', 'micro', 'deca', 'hecto', 'kilo', 'mega', 'giga'].includes(b.size)) err(path, 'bubble size');
  for (const part of ['header', 'body', 'footer']) if (b[part]) { if (b[part].type !== 'box') err(path + '.' + part, 'must be a box'); else box(b[part], path + '.' + part); }
}
function flexMessage(m, name) {
  bad.length = 0;
  expect(m.type).toBe('flex');
  expect(typeof m.altText === 'string' && m.altText.length > 0 && m.altText.length <= 400).toBe(true);
  const c = m.contents;
  if (c.type === 'carousel') { expect(c.contents.length).toBeLessThanOrEqual(12); c.contents.forEach((b, i) => bubble(b, `${name}.carousel[${i}]`)); }
  else bubble(c, name);
  expect(JSON.stringify(m).length).toBeLessThan(30000);
  return [...bad];
}

const NOW = Date.parse('2026-11-25T03:00:00Z');
const base = { active: true, unit: 'เม็ด', parFloor: 100, parSub: 500, used30: 600, floor: 0 };
const meds = [
  { ...base, id: '1', name: 'OMEPRAZOLE 20 mg แคปซูล', floor: 20, floorMin: 40 },
  { ...base, id: '2', name: 'METFORMIN 500 mg', floor: 0 },
  { ...base, id: '3', name: 'AMLODIPINE 10 mg', floor: 35, floorMin: 50, used30: 90 },
];
const lots = [{ medId: '1', qty: 50, lotNo: 'O2608', exp: NOW + 5 * 86400000 }, { medId: '3', qty: 120, lotNo: 'A2701', exp: NOW + 22 * 86400000 }];
const rec = (o) => ({ id: 'r' + Math.random(), medId: 'm1', medName: 'PARACETAMOL', unit: 'เม็ด', category: 'pain', hn: '1', qty: 10, value: 20, reason: 'ปรับเปลี่ยนการรักษา', note: '', date: '2026-10-15', ...o });

describe('Flex messages obey LINE rules', () => {
  it('daily stock alert (all sections present)', () => {
    expect(flexMessage(buildFlex(buildReport({ meds, lots, now: NOW, usageStatsRecomputedAt: NOW - 9 * 86400000 }), 'x'), 'stock')).toEqual([]);
  });
  it('monthly returns report (and the empty-month card)', () => {
    const records = [rec({ value: 500 }), rec({ category: 'cardio', reason: 'Non-compliance', value: 900 }), rec({ id: 'p', date: '2026-09-02', value: 100 }), rec({ reason: REVERSAL_PREFIX + 'ปรับเปลี่ยนการรักษา', note: '#zzz', value: 5 })];
    expect(flexMessage(buildMonthlyFlex(buildMonthlyReport({ records, month: '2026-10' })), 'monthly')).toEqual([]);
    expect(flexMessage(buildMonthlyFlex(buildMonthlyReport({ records: [], month: '2026-10' })), 'monthly-empty')).toEqual([]);
  });
  it('HOSxP reminder and the failure alert', () => {
    expect(flexMessage(reminderMessage(NOW), 'hosxp')).toEqual([]);
    expect(flexMessage(buildAlert({ ALERT_TITLE: 'x', ALERT_RUN_URL: 'https://github.com/a/b/actions/runs/1' }), 'alert')).toEqual([]);
    expect(flexMessage(alertFlex({ icon: 'x', title: 't', lines: ['l'] }), 'alertFlex')).toEqual([]);
  });
});
