/** Floor-stock shelf codes — shared between LabelsScreen (loc labels) and AppContext
 * (print sheet + loc-QR scan resolution), matching the bin codes generated in seed.ts. */
export const LOCS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];

/** Substock shelf/rack codes — the back-room counterpart to LOCS, its own independent
 * namespace (see Med.binSub) rather than reusing bin/binIpd (the floor codes), since a drug's
 * substock rack position has no reason to match, or even exist alongside, its floor shelf
 * spot. Deliberately the same code SHAPE as LOCS (A1..D2) — substock and floor are two
 * separate physical rooms, each with their own small grid of racks, so reusing the shape reads
 * naturally in both places. What actually keeps the two from being confused on scan is the QR
 * itself: a distinct payload type, 'locsub' (see qr.ts), not the code text. */
export const SUB_LOCS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];
