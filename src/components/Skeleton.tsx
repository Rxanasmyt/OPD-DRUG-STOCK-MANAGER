import type { CSSProperties } from 'react';

// The `.skeleton` shimmer class (gradient sweep, theme-aware) already existed in styles.css —
// built at some point but never actually wired up anywhere (grep found zero usages before this
// file). These are the pieces that finally use it: a blank screen with just "กำลังโหลด…" text
// reads as "is this stuck?" for a beat longer than a shape that already looks like the content
// about to arrive.

function Bar({ width = '100%', height = 12, radius, style }: { width?: string | number; height?: number; radius?: number; style?: CSSProperties }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius ?? 6, ...style }} />;
}

/** One skeleton list row — mirrors the common [dot] [title line] [sub line] row shape used all
 * over (TransferScreen, MedsScreen, AdminScreen, ...). */
function SkeletonRow() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '11px 13px', borderBottom: '1px solid var(--border-soft)' }}>
      <Bar width={9} height={9} radius={99} style={{ flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Bar width="58%" height={13} style={{ marginBottom: 7 }} />
        <Bar width="38%" height={10} />
      </div>
    </div>
  );
}

/** A card full of skeleton rows — drop-in stand-in for any "card stagger" list while its real
 * data is still loading. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}

/** Full first-load skeleton — mimics HomeScreen's rough shape (greeting, 4 stat tiles, a list)
 * closely enough that the very first thing anyone sees already looks like the app loading its
 * own data, not a blank page with a spinner. Shown only for the initial dbReady wait in App.tsx
 * — after that, real content is always in front of someone. */
export function SkeletonHome() {
  return (
    <div style={{ padding: '14px 14px 24px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
      <Bar width="52%" height={19} style={{ marginBottom: 8 }} />
      <Bar width="34%" height={12} style={{ marginBottom: 20 }} />
      <div className="grid-2" style={{ marginBottom: 18, gap: 10 }}>
        {Array.from({ length: 4 }).map((_, i) => <Bar key={i} height={74} radius={14} />)}
      </div>
      <Bar width="40%" height={13} style={{ marginBottom: 10 }} />
      <SkeletonList rows={4} />
    </div>
  );
}

/** Generic per-screen skeleton — used as the Suspense fallback while a lazy-loaded screen's
 * chunk is still downloading (a real network wait, not just render time, on a slow ward wifi).
 * Not screen-specific on purpose: a rough "search bar + list" shape reads as normal loading
 * content on almost every screen in this app, and it's gone the moment the real screen mounts. */
export function SkeletonScreen() {
  return (
    <div style={{ padding: '14px 14px 24px' }}>
      <Bar height={44} radius={10} style={{ marginBottom: 12 }} />
      <SkeletonList rows={5} />
    </div>
  );
}
