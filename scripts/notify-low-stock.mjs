#!/usr/bin/env node
// Real-world request: "แจ้งเตือนผ่าน LINE เมื่อยาต่ำกว่า par" — this app is a static site with
// no backend (see src/utils/notify.ts's own doc comment on why: no paid Cloud Functions plan
// just to run a schedule), so nothing in the browser can push a real notification once the tab
// is closed. Same free-tier answer as scripts/backup-firestore.mjs: GitHub Actions IS the
// server. This script reads today's real stock numbers via the Firebase Admin SDK (read-only)
// and broadcasts a LINE message via the Messaging API's Broadcast endpoint — sent to every
// account that has added the hospital's LINE Official Account as a friend, so there is no
// per-user/group ID to manage: everyone who wants the alert just adds the OA once.
//
// Skips sending entirely (not even an empty "all clear" ping) when nothing is actually low —
// a notification only earns its interruption when there's real work attached to it.
//
// Auth: FIREBASE_SERVICE_ACCOUNT_KEY (same secret backup-firestore.mjs uses) +
// LINE_CHANNEL_ACCESS_TOKEN (from the LINE Developers Console — see this repo's
// .github/workflows/low-stock-notify.yml for the one-time setup steps).
//
// To run locally:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" \
//   LINE_CHANNEL_ACCESS_TOKEN="..." node scripts/notify-low-stock.mjs
//   Add --dry-run to print the message instead of actually sending it.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APP_URL = 'https://rxanasmyt.github.io/OPD-DRUG-STOCK-MANAGER/';
const MAX_ROWS_PER_SECTION = 15; // keeps the broadcast readable — the app itself has the full list

// Kept in sync BY HAND with src/store/selectors.ts (floorMinOf/isUrgentLow/usesSubstock) — this
// script runs outside the TS/Vite build, so it can't import those directly. If those formulas
// change, update this block too.
function floorMinOf(m) {
  if (typeof m.floorMin === 'number') return m.floorMin;
  const raw = (m.parFloor || 0) * 0.3;
  if (raw <= 0) return 0;
  const step = raw >= 500 ? 100 : raw >= 100 ? 10 : raw >= 10 ? 5 : 1;
  return Math.round(raw / step) * step;
}
function usesSubstock(m) { return !m.noSubstock; }

async function lineBroadcast(token, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE broadcast failed: ${res.status} ${res.statusText} — ${body}`);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
  if (!dryRun && !lineToken) { console.error('LINE_CHANNEL_ACCESS_TOKEN env var is not set (pass --dry-run to test without it).'); process.exit(1); }

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  console.log('Reading meds/lots...');
  const [medSnap, lotSnap] = await Promise.all([db.collection('meds').get(), db.collection('lots').get()]);
  const meds = medSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.active);

  const subByMed = new Map();
  for (const d of lotSnap.docs) {
    const l = d.data();
    if (l.qty > 0) subByMed.set(l.medId, (subByMed.get(l.medId) || 0) + l.qty);
  }
  const subQty = (medId) => subByMed.get(medId) || 0;

  const belowMin = meds.filter((m) => (m.floor || 0) < floorMinOf(m));
  const belowSubPar = meds.filter((m) => usesSubstock(m) && subQty(m.id) < (m.parSub || 0));

  if (!belowMin.length && !belowSubPar.length) {
    console.log('Nothing below par today — skipping notification (no alert fatigue for a clean day).');
    return;
  }

  const dateLabel = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const section = (title, rows, fmt) => {
    if (!rows.length) return '';
    const shown = rows.slice(0, MAX_ROWS_PER_SECTION);
    const lines = shown.map((m) => `• ${m.name}: ${fmt(m)}`).join('\n');
    const more = rows.length > shown.length ? `\n…และอีก ${rows.length - shown.length} รายการ` : '';
    return `\n\n${title} (${rows.length} รายการ)\n${lines}${more}`;
  };

  const text = `📋 แจ้งเตือนสต็อกยา รพ.กรงปินัง\n${dateLabel}` +
    section('🔴 ต่ำกว่าจุดต้องเติม (Min) — ควรเติมวันนี้', belowMin, (m) => `${(m.floor || 0).toLocaleString('en-US')}/${floorMinOf(m).toLocaleString('en-US')} ${m.unit}`) +
    section('🟡 ต่ำกว่า par substock — ควรเบิกจากคลังใหญ่', belowSubPar, (m) => `${subQty(m.id).toLocaleString('en-US')}/${(m.parSub || 0).toLocaleString('en-US')} ${m.unit}`) +
    `\n\nเปิดแอพ: ${APP_URL}`;

  console.log('--- message ---\n' + text + '\n---------------');
  if (dryRun) { console.log('(--dry-run — not sending)'); return; }

  await lineBroadcast(lineToken, text);
  console.log(`Sent — ${belowMin.length} below Min, ${belowSubPar.length} below substock par.`);
}

main().catch((err) => {
  console.error('Low-stock notify failed:', err);
  process.exit(1);
});
