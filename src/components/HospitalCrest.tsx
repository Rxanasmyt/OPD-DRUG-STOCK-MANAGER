// Stylized recreation of the รพ.กรงปินัง hospital crest — two overlapping teal
// "wing"/book-page swooshes meeting in a V, one wing carrying a coral accent band,
// plus the small four-petal flower mark. Built as inline SVG (not a raster image)
// so it stays crisp at any size and can be dropped anywhere in the UI with just a
// `size` prop. Colors are the literal brand hex values (not CSS vars) because this
// mark IS the source the --green/--brand-coral tokens in styles.css were drawn
// from — it should render identically regardless of theme or token changes.
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
      <use href="#hospital-crest-wing" fill="#35c4b3" />
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
      <g transform="translate(168,148) scale(0.8)">
        <path d="M 0 -20 C 8 -20 10 -8 0 0 C -10 -8 -8 -20 0 -20 Z" fill="#0e8c82" />
        <path d="M 0 20 C 8 20 10 8 0 0 C -10 8 -8 20 0 20 Z" fill="#0e8c82" />
        <path d="M -20 0 C -20 -8 -8 -10 0 0 C -8 10 -20 8 -20 0 Z" fill="#0e8c82" />
        <path d="M 20 0 C 20 -8 8 -10 0 0 C 8 10 20 8 20 0 Z" fill="#0e8c82" />
      </g>
    </svg>
  );
}
