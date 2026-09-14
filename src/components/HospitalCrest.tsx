import crestSrc from '../assets/hospital-crest.png';

// The REAL รพ.กรงปินัง hospital crest — a cropped, background-removed cutout of the actual
// artwork (src/assets/hospital-crest-original.jpg), not a hand-drawn recreation. Earlier
// versions of this component were an approximation drawn from memory (this session had no
// way to pull the real file out of a pasted chat image); the actual file only became
// available once it was committed straight into this repo (see src/assets/), which sidesteps
// that limitation entirely. Swap crestSrc for a higher-resolution original if the hospital
// ever supplies one — this crop is only as sharp as the source photo it came from.
export default function HospitalCrest({ size = 40 }: { size?: number }) {
  return (
    <img
      src={crestSrc}
      alt="ตรารพ.กรงปินัง"
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
    />
  );
}
