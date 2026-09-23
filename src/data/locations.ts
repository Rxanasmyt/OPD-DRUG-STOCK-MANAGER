/** Floor-stock shelf codes — shared between LabelsScreen (loc labels) and AppContext
 * (print sheet + loc-QR scan resolution), matching the bin codes generated in seed.ts. */
export const LOCS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];

/** Real-world request: the pharmacy room (not the central warehouse) keeps its own cold-chain
 * storage — a vaccine fridge and a cold-drug fridge for stock arriving straight in (the
 * substock-equivalent stage for these), plus two shared service fridges both OPD and IPD pull
 * from for daily dispensing (the floor-equivalent stage) — same two-stage รับเข้า→เติมหน้างาน
 * flow as everything else, just refrigerated instead of a shelf. Kept as its own fixed code
 * list (same "print the position now" purpose LOCS serves for floor shelves) rather than
 * folding into LOCS/an ad-hoc binSub value, so a fridge position reads unmistakably as a
 * fridge — not a shelf — on both the printed label and in the location picker. A med assigned
 * to one of these still just uses its ordinary `bin`/`binIpd` (floor/service position) and
 * `binSub` (substock/storage position) fields — no new Med fields needed, this list only
 * supplies the codes to print/pick from and to distinguish fridge locations at a glance. */
export const FRIDGE_LOCS: [string, string][] = [
  ['FR-VAC1', 'ตู้เย็นคลังวัคซีน'],
  ['FR-DRG1', 'ตู้เย็นคลังยา'],
  ['FR-SVC1', 'ตู้เย็นบริการ 1'],
  ['FR-SVC2', 'ตู้เย็นบริการ 2'],
];
