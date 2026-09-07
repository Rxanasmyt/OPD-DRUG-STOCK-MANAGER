/**
 * A friendlier stand-in for the bare "ไม่พบ.../ยังไม่มี..." text-only messages scattered across
 * search results and empty lists — an icon plus a short explanation reads as "nothing to worry
 * about, here's why" instead of looking like the screen might be broken. `sub`, when given,
 * tells someone what to actually do about it (search a different term, add the first item,
 * etc.) rather than leaving them to guess.
 */
export function EmptyState({ icon = '🔍', title, sub }: { icon?: string; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '34px 20px', animation: 'fade .28s var(--ease-out) both' }}>
      <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.7, animation: 'checkPop .45s var(--ease-out) both' }} aria-hidden="true">{icon}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 5, lineHeight: 1.55, maxWidth: 280, marginLeft: 'auto', marginRight: 'auto' }}>{sub}</div>}
    </div>
  );
}
