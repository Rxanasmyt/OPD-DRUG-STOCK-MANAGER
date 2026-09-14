/**
 * Per-drug color coding — every med gets its own stable color, derived deterministically from
 * its `code` (e.g. "MED-0035"), so the same drug always shows the same color everywhere in the
 * app (เติมหน้างาน, รับเข้า, ปรับยอด, จัดการรายการยา, หน้าหลัก). The point isn't decoration —
 * two similar-sounding or similar-looking drug names sitting in adjacent rows are a real
 * look-alike/sound-alike medication error risk; a consistent color makes "this is a different
 * item than the one above it" register before anyone has to read the name closely.
 *
 * Hash → hue, fixed saturation/lightness so every color reads at the same visual weight (no
 * drug's color is accidentally harder to see than another's). Deliberately NOT random per
 * render — the same code always hashes to the same hue.
 */
// A plain `h = h*31 + c` hash does NOT avalanche for short, near-identical strings — every
// med code in this app is "MED-" + a zero-padded sequential number, so two adjacent codes
// (MED-0001, MED-0002 — exactly the kind of pair that ends up sorted next to each other in a
// by-name list) would hash to nearly-identical values and get nearly-identical hues, defeating
// the entire point of coloring them differently. FNV-1a + a Murmur3-style finalizer (bit
// mixing after the fact) decorrelates adjacent inputs properly.
function hashCode(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function hueOf(code: string): number {
  return hashCode(code || '') % 360;
}

/** Solid accent color for this med — dots, borders, small chips. */
export function medColor(code: string): string {
  return `hsl(${hueOf(code)}, 62%, 42%)`;
}

/** Pale tint of the same hue — safe as a background behind dark text. */
export function medColorTint(code: string): string {
  return `hsl(${hueOf(code)}, 65%, 95%)`;
}
