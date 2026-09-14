import { useMemo } from 'react';
import { qrModules } from '../utils/qr';

/** Real, scannable QR code — encodes `value` (a JSON payload from utils/qr.ts) and renders
 * the module matrix as inline SVG so it stays crisp at any print size and matches the
 * app's color language. */
export function QrCode({ value, size = 52 }: { value: string; size?: number }) {
  const modules = useMemo(() => qrModules(value), [value]);

  if (!modules) {
    return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', background: '#fff', borderRadius: 4 }} />;
  }

  const n = modules.size;
  const quiet = 2; // quiet-zone modules, keeps it scannable near label edges
  const total = n + quiet * 2;
  const cell = size / total;
  const rects: JSX.Element[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (modules.get(row, col)) {
        rects.push(<rect key={`${row}_${col}`} x={(col + quiet) * cell} y={(row + quiet) * cell} width={cell} height={cell} fill="#12211a" />);
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" style={{ display: 'block', background: '#fff', borderRadius: 4 }}>
      {rects}
    </svg>
  );
}
