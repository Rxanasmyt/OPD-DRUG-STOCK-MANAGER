// Best-effort recreation of the รพ.กรงปินัง hospital crest — two overlapping teal
// "wing"/book-page swooshes meeting in a V, one wing carrying a coral accent band,
// plus the small four-petal flower mark. Built as inline SVG (not a raster image)
// so it stays crisp at any size and can be dropped anywhere in the UI with just a
// `size` prop. Colors are the literal brand hex values (not CSS vars) because this
// mark IS the source the --green/--brand-coral tokens in styles.css were drawn
// from — it should render identically regardless of theme or token changes.
//
// Redrawn (2026-09-08) for closer fidelity to the hospital's real crest, after the first
// pass read as visibly off — flower repositioned with real clearance from the wing tip
// instead of touching it. Still a hand-drawn approximation, not the literal artwork: this
// session has no access to the actual logo file the real crest image was pasted from (chat
// image attachments in this environment don't persist to a readable file), so this is the
// most careful redraw achievable by eye. Swap this file for the literal asset the moment a
// real .png/.svg of the crest is available as an uploadable file, not a pasted chat image.
// This is the version meant to represent the REAL crest (login screen, printed letterhead) —
// kept deliberately separate from the app icon's own crest artwork (public/icon-*.png),
// which stays its own earlier, more stylized/simplified take by request (kept because it
// reads well small, not because it's claimed to be an accurate crest reproduction).
export default function HospitalCrest({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <path
          id="hospital-crest-wing"
          d="M 6 30
             C 4 8 30 -4 62 6
             C 40 34 78 110 100 168
             C 66 158 18 140 4 82
             C 1 62 2 44 6 30 Z"
        />
      </defs>
      <use href="#hospital-crest-wing" fill="#38c6b5" />
      <use
        href="#hospital-crest-wing"
        fill="#0e8c82"
        transform="translate(100,168) scale(0.85) translate(-100,-168)"
      />
      <g transform="translate(200,0) scale(-1,1)">
        <use href="#hospital-crest-wing" fill="#f2a077" />
        <use
          href="#hospital-crest-wing"
          fill="#0e8c82"
          transform="translate(100,168) scale(0.85) translate(-100,-168)"
        />
      </g>
      <g transform="translate(172,152) scale(0.9)">
        <path d="M 0 -20 C 8 -20 10 -8 0 0 C -10 -8 -8 -20 0 -20 Z" fill="#0e8c82" />
        <path d="M 0 20 C 8 20 10 8 0 0 C -10 8 -8 20 0 20 Z" fill="#0e8c82" />
        <path d="M -20 0 C -20 -8 -8 -10 0 0 C -8 10 -20 8 -20 0 Z" fill="#0e8c82" />
        <path d="M 20 0 C 20 -8 8 -10 0 0 C 8 10 20 8 20 0 Z" fill="#0e8c82" />
      </g>
    </svg>
  );
}
