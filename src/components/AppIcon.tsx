// The app's own icon (not the hospital crest): a glossy gradient squircle holding a capsule over three stacked
// "stock layers", with a twinkling spark. Pure SVG — scales from the 44px header chip to the 96px login hero.
import { useId } from 'react';

export default function AppIcon({ size = 64, glow = false }: { size?: number; glow?: boolean }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg className={'app-icon' + (glow ? ' app-icon--glow' : '')} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ไอคอนแอป Drug Substock" focusable="false">
      <defs>
        <linearGradient id={'ai-bg' + uid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#28e0d4" /><stop offset=".5" stopColor="#0b9490" /><stop offset="1" stopColor="#06504e" />
        </linearGradient>
        <linearGradient id={'ai-shine' + uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={'ai-pill' + uid} x1="0" y1="0" x2="1" y2="0">
          <stop offset=".5" stopColor="#fff" /><stop offset=".5" stopColor="#ffb08f" />
        </linearGradient>
        <radialGradient id={'ai-spot' + uid} cx=".85" cy=".1" r=".7">
          <stop offset="0" stopColor="#ff9f7e" stopOpacity=".85" /><stop offset="1" stopColor="#ff9f7e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#ai-bg${uid})`} />
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#ai-spot${uid})`} />
      <rect x="2" y="2" width="60" height="30" rx="17" fill={`url(#ai-shine${uid})`} />
      {/* stacked stock layers */}
      <rect x="14" y="44" width="36" height="5" rx="2.5" fill="#fff" opacity=".95" />
      <rect x="18" y="51" width="28" height="4" rx="2" fill="#fff" opacity=".6" />
      <rect x="22" y="57" width="20" height="3" rx="1.5" fill="#fff" opacity=".32" />
      {/* capsule */}
      <g transform="rotate(-38 32 28)">
        <rect x="14" y="19" width="36" height="17" rx="8.5" fill={`url(#ai-pill${uid})`} stroke="rgba(0,50,48,.35)" strokeWidth="1" />
        <rect x="18" y="22" width="12" height="3" rx="1.5" fill="#fff" opacity=".7" />
      </g>
      {/* AI spark */}
      <path className="app-icon-spark" d="M50 9 L51.8 14.2 L57 16 L51.8 17.8 L50 23 L48.2 17.8 L43 16 L48.2 14.2 Z" fill="#fff" />
    </svg>
  );
}
