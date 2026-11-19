// Drug-category picker: replaces a horizontally-scrolling strip of 21 long chip labels (only ~8
// visible, the rest hidden off-screen). A single bar shows the current choice; opening it reveals
// every category at once as colour-coded tiles with an icon and a count, in a wrapping grid — no
// sideways scrolling, one tap to choose, and it closes itself after a choice.
import { useEffect, useRef, useState } from 'react';
import { DRUG_CATEGORIES } from '../data/categories';

const CAT_STYLE: Record<string, { icon: string; color: string }> = {
  pain: { icon: '💊', color: '#e0662f' }, steroid: { icon: '🧪', color: '#b45309' }, antimicrobial: { icon: '🦠', color: '#0f9d6e' },
  oncology: { icon: '🎗️', color: '#a21caf' }, cardio: { icon: '❤️', color: '#dc2626' }, endocrine: { icon: '🩸', color: '#0e7490' },
  hormone_repro: { icon: '🌸', color: '#db2777' }, resp: { icon: '🫁', color: '#2563eb' }, gi: { icon: '🍽️', color: '#65a30d' },
  neuro_psych: { icon: '🧠', color: '#7c3aed' }, anesthetic: { icon: '💉', color: '#0891b2' }, allergy: { icon: '🤧', color: '#ca8a04' },
  derm: { icon: '🧴', color: '#c2410c' }, eye_ent: { icon: '👁️', color: '#0369a1' }, vitamin: { icon: '🍊', color: '#ea580c' },
  iv_fluid: { icon: '💧', color: '#1d4ed8' }, emergency: { icon: '🚑', color: '#b91c1c' }, vaccine_biologic: { icon: '🛡️', color: '#4f46e5' },
  herbal: { icon: '🌿', color: '#15803d' }, supply: { icon: '🩹', color: '#475569' }, other: { icon: '📦', color: '#64748b' },
};

export function CategoryPicker({ value, onChange, counts, total }: {
  value: 'all' | string;
  onChange: (v: 'all' | string) => void;
  counts: Record<string, number>;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const cur = value === 'all' ? null : DRUG_CATEGORIES.find((c) => c.id === value) ?? null;
  const curStyle = cur ? CAT_STYLE[cur.id] : null;
  const pick = (v: 'all' | string) => { onChange(v); setOpen(false); };

  return (
    <div className="catpick" ref={wrap} data-testid="category-picker">
      <div className="catpick-bar">
        <button
          type="button"
          className="catpick-btn"
          aria-expanded={open}
          aria-controls="catpick-panel"
          onClick={() => setOpen((o) => !o)}
          style={curStyle ? { ['--c' as string]: curStyle.color } : undefined}
        >
          <span className="catpick-ic" aria-hidden="true">{curStyle ? curStyle.icon : '🗂️'}</span>
          <span className="catpick-tx">
            <small>หมวดกลุ่มยา</small>
            <b>{cur ? cur.label : 'ทุกหมวด'} ({cur ? counts[cur.id] ?? 0 : total})</b>
          </span>
          <span className="catpick-chev" aria-hidden="true" data-open={open}>▾</span>
        </button>
        {cur && (
          <button type="button" className="catpick-clear" onClick={() => pick('all')} aria-label="ล้างตัวกรองหมวด — แสดงทุกหมวด">✕ ทุกหมวด</button>
        )}
      </div>
      {open && (
        <div id="catpick-panel" className="catpick-panel" role="group" aria-label="เลือกหมวดกลุ่มยา">
          <button type="button" className={'catpick-tile' + (value === 'all' ? ' on' : '')} aria-pressed={value === 'all'} onClick={() => pick('all')} style={{ ['--c' as string]: 'var(--green)' }}>
            <span aria-hidden="true">🗂️</span>
            <span className="catpick-name">ทุกหมวด</span>
            <span className="catpick-n">{total}</span>
          </button>
          {DRUG_CATEGORIES.map((c) => {
            const n = counts[c.id] ?? 0;
            if (!n) return null;
            const st = CAT_STYLE[c.id] ?? { icon: '📦', color: '#64748b' };
            return (
              <button key={c.id} type="button" className={'catpick-tile' + (value === c.id ? ' on' : '')} aria-pressed={value === c.id} onClick={() => pick(c.id)} style={{ ['--c' as string]: st.color }}>
                <span aria-hidden="true">{st.icon}</span>
                <span className="catpick-name">{c.label}</span>
                <span className="catpick-n">{n}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
