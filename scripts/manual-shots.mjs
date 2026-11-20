// Regenerates the screenshots used by the in-app manual (public/manual/*.jpg) from the REAL UI with invented demo data.
//   npm run manual:shots        (needs Playwright's Chromium, which is preinstalled in the cloud dev environment)
// Builds the app against fake Firebase modules (vite.manual.config.ts), serves it from disk (no server, no network),
// drives it like a user, and saves phone-sized JPEGs. Re-run it whenever a documented screen changes.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { meds, lots, floorLots, users, txs, returnsToday } from './manual-shots/fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'manual');
const dist = path.join(root, '.manual-build');
const only = process.argv[2];
fs.mkdirSync(out, { recursive: true });
if (!only || only !== '--skip-build') execSync('npx vite build -c vite.manual.config.ts', { cwd: root, stdio: 'ignore' });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
const page = await ctx.newPage();
await page.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.host !== 'localhost') return r.abort();
  let f = path.join(dist, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
  r.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 300)); });

const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, name + '.jpg'), type: 'jpeg', quality: 82 }); console.log('saved', name); };
const demo = (fn, arg) => page.evaluate(fn, arg);

await page.goto('http://localhost/');
await page.waitForFunction(() => window.__demo && window.__demo.hasAuthListener && window.__demo.hasAuthListener());
await demo(() => window.__demo.fireAuth(null));
await page.waitForSelector('[data-testid=open-manual]');
await shot('01-login');
await page.click('button:has-text("สมัครสมาชิก") >> nth=0'); await shot('01b-register');
await page.click('button:has-text("เข้าสู่ระบบ") >> nth=0');

await demo(() => window.__demo.fireAuth({ uid: 'demo' }));
await page.waitForFunction(() => window.__demo.hasListener('users/demo'));
await demo((u) => window.__demo.fireDoc('users/demo', u), users[0]);
await page.waitForFunction(() => window.__demo.hasListener('meds'));
await demo((d) => {
  const D = window.__demo;
  D.fireCollection('meds', d.meds); D.fireCollection('lots', d.lots); D.fireCollection('floorLots', d.floorLots);
  D.fireCollection('txs', d.txs); D.fireCollection('users', d.users); D.seedCollection('returns', d.returnsToday);
}, { meds, lots, floorLots, txs, users, returnsToday });
await page.waitForTimeout(1200);
await shot('02-home');

const nav = async (label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(700); };
const more = async (label) => { await nav('เพิ่มเติม'); await page.click(`button:has-text("${label}")`); await page.waitForTimeout(800); };

// --- เติมหน้างาน
await nav('เติมหน้างาน');
await shot('03-transfer');
// --- นำเข้า HOSxP
await nav('นำเข้า HOSxP');
await shot('04-hosxp-empty');
// --- HOSxP: แนบไฟล์ตัวอย่าง (สร้างจากยาตัวอย่างในแอป — ชื่อเรียงต่างกันเพื่อโชว์การจับคู่อัจฉริยะ)
const XLSX = createRequire(import.meta.url)('xlsx');
const d = new Date(Date.now() - 86400000);
const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const dateTxt = `${d.getDate()} ${thMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
const HDR = ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'รายการ', 'จำนวน', 'มูลค่า', 'ต้นทุน'];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  [`รายงานการใช้ยา ${dateTxt} - ${dateTxt}`], HDR,
  [1, 'Amlodipine', '10 mg', 'เม็ด', 410, 1558, 3895, 2800],
  [2, 'Paracetamol', '500 mg', 'เม็ด', 980, 2400, 6000, 3100],
  [3, 'Metformin tablet', '500 mg', 'เม็ด', 300, 620, 1550, 900],
  [4, 'Omeprazole capsule', '20 mg', 'แคปซูล', 120, 180, 450, 260],
  [5, 'Ceftriaxone inj', '1 g', 'ขวด', 30, 35, 1750, 900],
  [6, 'Loratadine', '10 mg', 'เม็ด', 150, 210, 525, 300],
  [7, 'ยาตัวอย่างที่ไม่มีในแอป XYZ', '5 mg', 'เม็ด', 4, 12, 60, 40],
  ['', 'รวม', '', '', 1994, 5015, 14230, 8300],
]), 'Sheet1');
const xlsxPath = path.join(root, '.manual-build', 'demo-hosxp.xlsx');
fs.writeFileSync(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
await nav('นำเข้า HOSxP');
await page.setInputFiles('input[type=file]', xlsxPath);
await page.waitForSelector('[data-testid=reconcile-status]');
const scrollMain = (y) => page.evaluate((v) => { document.querySelector('main').scrollTop = v; }, y);
await page.waitForTimeout(4200); // let the toast fade out
await scrollMain(0); await shot('05-hosxp-attached');
await scrollMain(560); await shot('05b-hosxp-fix');
const accept = page.locator('[data-testid=accept-safe-all]');
if (await accept.count()) { await accept.first().click(); await page.waitForTimeout(600); }
await scrollMain(0);
await page.waitForTimeout(4200);
await scrollMain(300); await shot('05c-hosxp-status');
// resolve the leftover unknown row (skip it), acknowledge the unusual quantity → ready
const skipBtn = page.locator('[data-testid=file-row-fixer] button:has-text("ไม่ต้อง")');
if (await skipBtn.count()) { await skipBtn.first().click(); await page.waitForTimeout(500); }
const ack = page.locator('[data-testid=ack-unusual] input[type=checkbox]');
if (await ack.count()) { await ack.first().check(); await page.waitForTimeout(400); }
await scrollMain(300); await page.waitForTimeout(300);
await shot('06-hosxp-ready');
await page.click('.rc-commit-btn');
await page.waitForTimeout(700);
await shot('06b-hosxp-confirm');
await page.locator('button:has-text("ยืนยัน")').last().click();
await page.waitForSelector('[data-testid=reconcile-result]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(4200);
await page.evaluate(() => document.querySelector('[data-testid=reconcile-result]')?.scrollIntoView({ block: 'start' }));
await shot('07-hosxp-result');

const probe = async (label) => console.log('PROBE', label, JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('main button, main input, main [role=tab]')).slice(0, 40).map((e) => (e.tagName === 'INPUT' ? 'INPUT:' + (e.placeholder || e.type) : (e.textContent || '').trim().slice(0, 28))))));
if (process.env.PROBE) {
  await nav('เติมหน้างาน'); await probe('transfer');
  await nav('รับเข้า'); await probe('receive');
  await more('ปรับยอด / คืนยา'); await probe('adjust');
  await more('นับสต็อกหน้างาน'); await probe('count');
}
// --- เติมหน้างาน: เลือกยา → ตรวจสอบ → เสร็จสิ้น
await nav('เติมหน้างาน');
await scrollMain(0);
const plus = page.locator('main button:text-is("+")');
for (let i = 0; i < 3; i++) await plus.first().click();
await page.waitForTimeout(400);
await page.waitForTimeout(3600);
await scrollMain(560); await shot('03b-transfer-added');
await page.locator('button:has-text("ตรวจสอบ")').last().click();
await page.waitForTimeout(1000); await shot('03c-transfer-confirm');
await page.locator('button:has-text("ยืนยันการเติมหน้างาน")').click();
await page.waitForTimeout(1200); await shot('03d-transfer-done');
// --- รับเข้า
await nav('รับเข้า'); await scrollMain(0); await shot('08-receive');
await page.fill('input[placeholder*="ค้นหา / สแกนชื่อยา"]', 'AMLODIPINE'); await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('input[placeholder*="สแกนชื่อยา"]').scrollIntoView({ block: 'start' }));
await shot('08b-receive-search');
await page.getByText('AMLODIPINE 10 mg เม็ด').first().click();
await page.waitForTimeout(900); await shot('08c-receive-form');
await page.fill('input[placeholder="เช่น A2609"]', 'A2609');
await page.fill('input[type=date] >> nth=-1', '2027-12-31');
const qtyInputs = page.locator('[role=dialog] input, .bottom-sheet input, input[inputmode]');
await page.evaluate(() => { const ins = Array.from(document.querySelectorAll('input')); const q = ins[ins.length - 1]; q.focus(); });
await page.keyboard.type('600');
await page.waitForTimeout(400); await shot('08d-receive-filled');
await page.locator('button:has-text("เพิ่มลงใบรับ")').click();
await page.waitForTimeout(900); await scrollMain(560); await shot('08e-receive-list');
await page.locator('button:has-text("รับเข้า substock")').last().click();
await page.waitForTimeout(1200); await shot('08f-receive-done');
await probe('receive-done');
// --- ปรับยอด/คืนยา
await more('ปรับยอด / คืนยา');
await page.locator('main button:has-text("คืนยา")').first().click(); await page.waitForTimeout(800);
await page.fill('input[placeholder="เช่น 1234567"]', '6611111');
await page.waitForTimeout(400); await shot('11b-adjust-return');
await page.fill('input[placeholder="ค้นหาชื่อยา"]', 'PARACETAMOL'); await page.waitForTimeout(500);
await page.getByText('PARACETAMOL 500 mg เม็ด').first().click(); await page.waitForTimeout(600);
await page.evaluate(() => { const e = Array.from(document.querySelectorAll('input')).filter((i) => i.type !== 'hidden'); });
await page.locator('label:has-text("จำนวนที่คืน") input').first().fill('20');
await page.waitForTimeout(300); await scrollMain(380); await shot('11c-return-reasons');
await page.getByRole('button', { name: 'ไม่ประสงค์รับยา' }).click(); await page.waitForTimeout(500);
await scrollMain(760); await shot('11d-return-bar');
await page.evaluate(() => document.querySelector('[data-testid=today-returns]')?.scrollIntoView({ block: 'start' }));
await page.locator('[data-testid=today-returns] button:has-text("รายการคืนวันนี้")').click(); await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector('[data-testid=today-returns]')?.scrollIntoView({ block: 'start' }));
await shot('11e-return-today');
// --- เพิ่มเติม และหน้าย่อย
await nav('เพิ่มเติม'); await shot('10-more');
for (const [id, label] of [['11-adjust', 'ปรับยอด / คืนยา'], ['12-count', 'นับสต็อกหน้างาน'], ['13-wardmove', 'ย้ายยาระหว่างชั้นวาง'], ['14-par', 'par อัตโนมัติ'], ['15-report', 'รายงานและ Export'], ['16-substockcard', 'บัตรคุมยา'], ['17-labels', 'ระบบฉลาก QR'], ['18-admin', 'จัดการผู้ใช้'], ['19-meds', 'จัดการรายการยา']]) {
  await more(label); await shot(id);
}
console.log('listeners:', JSON.stringify(await demo(() => window.__demo.listenerPaths())));
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
