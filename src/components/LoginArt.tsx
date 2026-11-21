// Decorative login backdrop: the hospital lobby's wood-slat ceiling + teal beams drawn as vector art
// (perspective slats converging on the reception wall, glowing light strips, drifting sparks).
// Pure SVG + CSS, no image download, aria-hidden. Motion is switched off by prefers-reduced-motion.
const VX = 500;          // vanishing point x
const VY = 300;          // vanishing point y (where the ceiling meets the reception wall)
const SLATS = 41;

function slatPath(i: number): string {
  // spread along the top edge, converge toward the back wall
  const t = i / (SLATS - 1);
  const x0 = -420 + t * 1840;          // top-left x of the slat
  const w0 = 26;                       // slat width at the top
  const k = 0.2;                       // how much it pulls toward the vanishing point
  const x1 = VX + (x0 - VX) * k;
  const w1 = w0 * k;
  return `M${x0} -20 L${x0 + w0} -20 L${x1 + w1} ${VY} L${x1} ${VY} Z`;
}

export default function LoginArt({ calm = false }: { calm?: boolean }) {
  const slats = Array.from({ length: SLATS }, (_, i) => i);
  const lights = [-300, -150, 0, 150, 300].map((dx, i) => ({ i, dx }));
  return (
    <div className={'login-art' + (calm ? ' login-art--calm' : '')} aria-hidden="true">
      <svg viewBox="0 0 1000 800" preserveAspectRatio="xMidYMin slice" focusable="false">
        <defs>
          <linearGradient id="la-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e9b27a" /><stop offset="1" stopColor="#8a5a35" />
          </linearGradient>
          <linearGradient id="la-teal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#19b3ad" /><stop offset="1" stopColor="#0a6f6c" />
          </linearGradient>
          <radialGradient id="la-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffe3d2" stopOpacity=".85" /><stop offset="1" stopColor="#ffe3d2" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="la-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset=".75" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="la-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b2a2b" stopOpacity="0" /><stop offset="1" stopColor="#0b2a2b" stopOpacity=".4" />
          </linearGradient>
          <linearGradient id="la-wf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" /><stop offset=".25" stopColor="#fff" /><stop offset=".6" stopColor="#fff" /><stop offset="1" stopColor="#000" />
          </linearGradient>
          <linearGradient id="la-sf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" /><stop offset=".55" stopColor="#fff" /><stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="la-slatfade"><rect x="-500" y="-20" width="2000" height="320" fill="url(#la-sf)" /></mask>
          <mask id="la-wallfade"><rect x="340" y="300" width="320" height="200" fill="url(#la-wf)" /></mask>
          <mask id="la-mask"><rect width="1000" height="800" fill="url(#la-fade)" /></mask>
        </defs>
        <g mask="url(#la-mask)">
          <g mask="url(#la-slatfade)">
          {/* teal ceiling beams, left + right, in perspective */}
          <path d="M-200 -20 L180 -20 L430 300 L330 300 Z" fill="url(#la-teal)" opacity=".9" />
          <path d="M1200 -20 L820 -20 L570 300 L670 300 Z" fill="url(#la-teal)" opacity=".9" />
          {/* wood slats */}
          <g className="la-slats">
            {slats.map((i) => (
              <path key={i} d={slatPath(i)} fill="url(#la-wood)" style={{ animationDelay: (i * 0.14).toFixed(2) + 's' }} opacity=".82" stroke="rgba(30,18,8,.55)" strokeWidth="1.2" />
            ))}
          </g>
          </g>
          {/* reception back wall: vertical slats + teal posts + glow behind the logo */}
          <g mask="url(#la-wallfade)">
          <rect x="372" y="300" width="256" height="200" fill="#c98f5a" opacity=".78" />
            {Array.from({ length: 16 }, (_, i) => <rect key={i} x={374 + i * 16} y="300" width="9" height="200" fill="#7a4d2b" opacity=".45" />)}
            <rect x="350" y="300" width="22" height="200" fill="#14a29d" /><rect x="628" y="300" width="22" height="200" fill="#14a29d" />
            </g>
          <ellipse className="la-halo" cx="500" cy="390" rx="170" ry="110" fill="url(#la-glow)" />
          {/* ceiling light strips, perspective-scaled */}
          {lights.map(({ i, dx }) => {
            const x = VX + dx, x1 = VX + dx * 0.2;
            return <path key={i} className="la-light" style={{ animationDelay: (i * 0.7) + 's' }} d={`M${x - 7} 30 L${x + 7} 30 L${x1 + 1.4} 250 L${x1 - 1.4} 250 Z`} fill="#fff" />;
          })}
        </g>
        {/* floor reflection */}
        <rect x="0" y="470" width="1000" height="330" fill="url(#la-floor)" />
        {/* drifting sparks */}
        {!calm && Array.from({ length: 14 }, (_, i) => (
          <circle key={i} className="la-spark" cx={(i * 173) % 1000} cy={420 + ((i * 97) % 300)} r={1.6 + (i % 3)} fill="#ffd9c9"
            style={{ animationDelay: (i * 0.9).toFixed(1) + 's', animationDuration: 9 + (i % 5) * 2 + 's' }} />
        ))}
      </svg>
    </div>
  );
}
