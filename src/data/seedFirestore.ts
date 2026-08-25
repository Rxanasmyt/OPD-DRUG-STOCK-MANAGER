import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { loadMasterMeds, seedLots } from './seed';

const CHUNK = 400; // stay under Firestore's 500-writes-per-batch limit

async function writeInChunks(colName: string, docs: { id: string; [k: string]: unknown }[]) {
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + CHUNK)) {
      const { id, ...rest } = d;
      batch.set(doc(collection(db, colName), id), rest);
    }
    await batch.commit();
  }
}

/** One-time bootstrap: populate empty meds/lots collections with the starter formulary. */
export async function seedInitialData(): Promise<{ meds: number; lots: number }> {
  const meds = loadMasterMeds();
  const lots = seedLots(meds);
  await writeInChunks('meds', meds as unknown as { id: string }[]);
  await writeInChunks('lots', lots as unknown as { id: string }[]);
  return { meds: meds.length, lots: lots.length };
}
