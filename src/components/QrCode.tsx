/**
 * Demo-only QR glyph: a deterministic pseudo-random pattern derived from the payload
 * string, styled like a QR code (finder squares + noise). Not a real scannable QR —
 * the production app would generate real codes and read them via html5-qrcode.
 */
export function QrCode({ value, size = 52 }: { value: string; size?: number }) {
  const n = 21;
  const cell = size / n;
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  const rects: JSX.Element[] = [];
  const finder = (ox: number, oy: number) => {
    rects.push(<rect key={`f${ox}${oy}`} x={ox * cell} y={oy * cell} width={7 * cell} height={7 * cell} fill="#12211a" />);
    rects.push(<rect key={`g${ox}${oy}`} x={(ox + 1) * cell} y={(oy + 1) * cell} width={5 * cell} height={5 * cell} fill="#fff" />);
    rects.push(<rect key={`i${ox}${oy}`} x={(ox + 2) * cell} y={(oy + 2) * cell} width={3 * cell} height={3 * cell} fill="#12211a" />);
  };
  let s = h || 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const inFinder = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (inFinder) continue;
      s = (s * 1103515245 + 12345) >>> 0;
      if ((s >>> 16) % 100 < 47) rects.push(<rect key={`${x}_${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill="#12211a" />);
    }
  }
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', background: '#fff', borderRadius: 4 }}>
      {rects}
    </svg>
  );
}
