import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from a GitHub Pages project site (https://<user>.github.io/<repo>/), so
// asset URLs need the repo name as a base path. Local dev still runs at "/".
const base = process.env.GITHUB_PAGES ? '/OPD-DRUG-STOCK-MANAGER/' : '/';

export default defineConfig({
  base,
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
        theme_color: '#17552f',
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
      },
    }),
  ],
});
