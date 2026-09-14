// vitest/config re-exports vite's defineConfig with the `test` field's types merged in — a
// plain `vite build`/`vite dev` never reads that field, so this has no effect outside `vitest`.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from a GitHub Pages project site (https://<user>.github.io/<repo>/), so
// asset URLs need the repo name as a base path. Local dev still runs at "/".
const base = process.env.GITHUB_PAGES ? '/OPD-DRUG-STOCK-MANAGER/' : '/';

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      output: {
        // Bug-adjacent fix (performance): every single deploy this app ships (and it ships
        // often — see CHANGELOG.md) used to force every returning device to re-download the
        // ENTIRE ~1.1MB main bundle, because react/react-dom/firebase (which almost never
        // change version-to-version) were bundled into the same one file as the app code that
        // changes on every deploy. Splitting stable, rarely-changing vendor code into its own
        // chunk(s) means a browser that already cached them from a previous visit only needs
        // to fetch the actual app-code chunk on the next deploy — real bandwidth/time saved on
        // a PWA opened repeatedly on the same ward wifi that prompted the "ไม่ให้รีโหลดแอพใหม่"
        // stability work earlier. react-dom is intentionally split from qr/firebase since it's
        // the least likely of the three to change together with app updates.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'vendor-qr': ['qrcode', 'jsqr'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // Bug fix (stability): 'autoUpdate' silently reloads the page the moment it detects a
      // new deployed version — during active use (mid-scan, mid-form, mid-transaction) that's
      // a real disruption, not a convenience, and this app gets redeployed often. 'prompt'
      // still fetches the new service worker in the background the same way, but leaves
      // activating it up to an explicit tap (see the "มีเวอร์ชันใหม่" banner wired up in
      // AppContext.tsx/UpdateBanner.tsx) — nobody gets yanked out of what they're doing.
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'KPNHOS-DRUG SUBSTOCK-OPD-IPD-MANAGEMENT',
        short_name: 'KPNHOS Substock',
        description: 'KPNHOS-DRUG SUBSTOCK-OPD-IPD-MANAGEMENT — ระบบจัดการสต็อกยา OPD/IPD รพ.กรงปินัง — เติมหน้างานแบบ FEFO, รับเข้า substock, ปรับยอด, นำเข้า HOSxP, รายงาน และฉลาก QR',
        lang: 'th',
        theme_color: '#007371',
        background_color: '#f7f6f2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Single-page app with no server API to worry about — cache-first for the
        // build output, always revalidate in the background on each load.
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        cleanupOutdatedCaches: true,
        // Adds a notificationclick handler (public/sw-custom.js) to the generated service
        // worker — generateSW mode doesn't expose a way to write custom SW logic directly, but
        // importScripts runs this file in the same worker. Needed so tapping the "ยาใกล้หมดอายุ"
        // notification (src/utils/notify.ts) actually opens the app instead of just dismissing.
        importScripts: ['sw-custom.js'],
      },
    }),
  ],
  // Dev/CI-only — `test` is ignored by `vite build`, so this has zero effect on the deployed
  // app. Added alongside a first real unit-test suite (src/**/*.test.ts) covering the pure
  // stock-math functions this app has run entirely on trust so far: FEFO lot picking, par
  // suggestion, usage-anomaly detection, days-of-stock-left, QR encode/parse round-tripping,
  // and the HOSxP import parsers. None of these were ever covered by anything but manual
  // testing + tsc — a real gap for logic this safety-critical (miscounting a controlled drug's
  // stock is not a cosmetic bug) on an app that redeploys as often as this one does.
  // 'jsdom' (not 'node') so component tests can actually render — the pre-existing 102 pure
  // logic tests (selectors/utils) run identically under jsdom, just with a DOM available for
  // the new screen-level integration tests alongside them. setupFiles wires in jest-dom's
  // matchers (toBeInTheDocument() etc.) globally so individual test files don't each need to
  // import it themselves.
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
