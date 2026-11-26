// Shared MOPH Notify helpers (LINE group via the "หมอพร้อม" bot) — used by notify-low-stock.mjs, notify-hosxp-missing.mjs and
// notify-alert.mjs. API: POST https://morpromt2f.moph.go.th/api/notify/send with headers client-key / secret-key and body { messages }.
// Success = HTTP 2xx AND message_code 200 (wrong keys / bad message format come back as `message_code: 401` in the body).
export const APP_URL = 'https://rxanasmyt.github.io/OPD-DRUG-STOCK-MANAGER/';

export async function mophNotify(clientKey, secretKey, messages) {
  const res = await fetch('https://morpromt2f.moph.go.th/api/notify/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'client-key': clientKey, 'secret-key': secretKey },
    body: JSON.stringify({ messages }),
  });
  const raw = await res.text().catch(() => '');
  let code;
  try { code = JSON.parse(raw).message_code; } catch { /* non-JSON body */ }
  if (!res.ok || (code !== undefined && Number(code) !== 200)) {
    throw new Error(`MOPH Notify failed: ${res.status} — ${raw.slice(0, 200)}`);
  }
}

const grad = (c1, c2) => ({ type: 'linearGradient', angle: '135deg', startColor: c1, endColor: c2 });

/** A single coloured alert card (Flex). `tone`: 'red' | 'orange' | 'teal'. */
export function alertFlex({ icon, title, lines, tone = 'red', buttonLabel = 'เปิดแอปสต็อกยา', buttonUri = APP_URL, footnote }) {
  const t = { red: ['#FF5F6D', '#B71C1C', '#FFEBEE'], orange: ['#FFA040', '#E65100', '#FFF3E0'], teal: ['#02B0AE', '#004C4B', '#E1F7F6'] }[tone] || ['#FF5F6D', '#B71C1C', '#FFEBEE'];
  return {
    type: 'flex',
    altText: `${icon} ${title}`.slice(0, 400),
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'horizontal', paddingAll: '16px', background: grad(t[0], t[1]), contents: [
        { type: 'text', text: icon, size: '3xl', flex: 0, gravity: 'center' },
        { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true, margin: 'md', flex: 1, gravity: 'center' },
      ] },
      body: { type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm', contents: [
        ...lines.map((l) => ({ type: 'text', text: l, size: 'sm', wrap: true, color: '#12211A' })),
        ...(footnote ? [{ type: 'text', text: footnote, size: 'xxs', color: '#8A918B', wrap: true, margin: 'md' }] : []),
      ] },
      ...(buttonUri ? { footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: t[1], height: 'sm', action: { type: 'uri', label: buttonLabel, uri: buttonUri } },
      ] } } : {}),
    },
  };
}

/** Send to MOPH when the keys are configured; otherwise just log. Returns true if sent.
 * `required`: a scheduled report/reminder whose ONLY purpose is the message must FAIL (red run) when the keys are missing — a green run that
 * silently sent nothing looks exactly like "working". Failure alerts (notify-alert.mjs) stay optional so they never mask the original failure. */
export async function sendIfConfigured(messages, env = process.env, { required = false } = {}) {
  const k = env.MOPH_NOTIFY_CLIENT_KEY; const s = env.MOPH_NOTIFY_SECRET_KEY;
  if (!k || !s) {
    if (required) throw new Error('MOPH_NOTIFY_CLIENT_KEY / MOPH_NOTIFY_SECRET_KEY are not set (GitHub → Settings → Secrets and variables → Actions).');
    console.log('MOPH_NOTIFY_CLIENT_KEY / MOPH_NOTIFY_SECRET_KEY not set — not sending.'); return false;
  }
  await mophNotify(k, s, messages);
  console.log('MOPH Notify: sent to LINE group.');
  return true;
}

// ---- Exact Thai-time sending --------------------------------------------------------------------------------------------------
// GitHub's `schedule` trigger is UTC and often starts a run several minutes late, so a plain "0 0 * * 1-5" does not deliver at 07:00:00
// Thai time. Instead the workflow starts EARLY (e.g. 06:30) and the script waits here until the exact Bangkok clock time, THEN reads the
// data and sends — so the message goes out on the minute, with data as fresh as the send. A run that starts late simply sends at once.
const BKK_MS = 7 * 3600000;
const DAY_MS = 86400000;
export const bkkStartOfDay = (ms) => Math.floor((ms + BKK_MS) / DAY_MS) * DAY_MS - BKK_MS;

/** Milliseconds from `now` until `HH:MM` Bangkok time today; 0 if already past. null if `hhmm` is not a valid "HH:MM". */
export function msUntilBangkokTime(hhmm, now = Date.now()) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const target = bkkStartOfDay(now) + Number(m[1]) * 3600000 + Number(m[2]) * 60000;
  return Math.max(0, target - now);
}

/** Wait until HH:MM Bangkok time (env TARGET_TIME_BKK). No-op when unset (manual runs), invalid, already past, or further away than
 * `maxWaitMs` (a wrong guess must never park a job for hours). Returns what happened, for logging/tests. */
export async function waitUntilBangkokTime(hhmm, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 50 * 60000 } = {}) {
  if (!hhmm) return { waited: 0, reason: 'no target' };
  const ms = msUntilBangkokTime(hhmm, now());
  if (ms === null) { console.log(`TARGET_TIME_BKK "${hhmm}" is not HH:MM — sending at once.`); return { waited: 0, reason: 'invalid' }; }
  if (ms === 0) { console.log(`Past ${hhmm} (Bangkok) already — sending at once.`); return { waited: 0, reason: 'late' }; }
  if (ms > maxWaitMs) { console.log(`${hhmm} (Bangkok) is ${Math.round(ms / 60000)} min away — more than the ${Math.round(maxWaitMs / 60000)} min limit, sending at once.`); return { waited: 0, reason: 'too far' }; }
  console.log(`Waiting ${Math.round(ms / 1000)} s until ${hhmm} Bangkok time…`);
  await sleep(ms);
  return { waited: ms, reason: 'waited' };
}

// ---- Run health stamps -------------------------------------------------------------------------------------------------------------
// Each scheduled notifier records that it RAN (and how it ended) in meta/notifyStatus.<kind> via the Admin SDK (bypasses rules; the app may
// read meta/*). The app warns an admin when a job has not run for days or its last run failed — otherwise a stopped scheduler, a revoked
// key or a disabled workflow is silent. "Ran" is stamped even when nothing needed sending (a clean day is a healthy run).
export async function stampRun(db, kind, result, extra = {}) {
  try {
    await db.doc('meta/notifyStatus').set({ [kind]: { ranAt: Date.now(), result, ...extra } }, { merge: true });
  } catch (e) { console.error('could not stamp meta/notifyStatus.' + kind + ':', e.message || e); }
}
