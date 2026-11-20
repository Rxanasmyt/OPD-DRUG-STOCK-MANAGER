// The app's real icon — the same artwork as the home-screen/PWA icon (public/icon-192.png: teal squircle,
// stacked tablets forming a stock-level chart, one coral tablet on top) — so the in-app mark and the icon
// people tap to open the app are one and the same. BASE_URL matters: the live site is served from a sub-path
// (GitHub Pages /OPD-DRUG-STOCK-MANAGER/), where an absolute "/icon-192.png" is a 404 (broken image).
export default function AppIcon({ size = 64, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <img
      className={'app-icon' + (glow ? ' app-icon--glow' : '')}
      src={import.meta.env.BASE_URL + 'icon-192.png'} width={size} height={size} alt="ไอคอนแอป Drug Substock" draggable={false}
      style={{ borderRadius: Math.round(size * 0.225), display: 'block' }}
    />
  );
}
