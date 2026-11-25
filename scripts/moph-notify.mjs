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

/** Send to MOPH when the keys are configured; otherwise just log. Returns true if sent. */
export async function sendIfConfigured(messages, env = process.env) {
  const k = env.MOPH_NOTIFY_CLIENT_KEY; const s = env.MOPH_NOTIFY_SECRET_KEY;
  if (!k || !s) { console.log('MOPH_NOTIFY_CLIENT_KEY / MOPH_NOTIFY_SECRET_KEY not set — not sending.'); return false; }
  await mophNotify(k, s, messages);
  console.log('MOPH Notify: sent to LINE group.');
  return true;
}
