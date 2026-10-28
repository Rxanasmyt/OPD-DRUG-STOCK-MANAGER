// Repository module for the `whRequestRounds` Firestore collection — one doc per requisition
// category (tab/liquid/injection/external, see data/reqCategories.ts), overwritten every time
// printWarehouseRequestByCategory() (AppContext.tsx) prints that category. Real-world request:
// the hospital's original Google-Sheet-based requisition had a "ยาที่ค้าง" (still outstanding
// from last time) column — see printWarehouseRequestByCategory's own doc comment for the exact
// carryover calculation this backs. Doc id = the category itself, so there's always exactly one
// "last round" per category to compare against — no growing history, no query/index needed to
// find the most recent one.
import { doc, type DocumentReference } from 'firebase/firestore';
import { db } from '../../firebase';
import type { ReqCategory } from '../../data/reqCategories';

export interface WhRequestRoundLine {
  qty: number;
  /** This med's curBalance at the moment this round was printed — see
   * printWarehouseRequestByCategory's own doc comment for why carryover is estimated from this
   * instead of a tx-history scan (state.txs is capped to the 300 most-recent rows app-wide,
   * not reliably deep enough to cover a ~2-week requisition cycle). */
  curBalanceAtPrint: number;
}

export interface WhRequestRound {
  printedAt: number;
  printedBy: string;
  lines: Record<string, WhRequestRoundLine>;
}

export function whRequestRoundRef(category: ReqCategory): DocumentReference {
  return doc(db, 'whRequestRounds', category);
}
