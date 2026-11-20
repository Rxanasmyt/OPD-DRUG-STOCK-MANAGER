// Build used ONLY by scripts/manual-shots.mjs: the real app bundled against fake Firebase modules so the manual's
// screenshots can be taken from the real UI with demo data (no network, no real project, no service worker).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^virtual:pwa-register$/, replacement: p('./scripts/manual-shots/shims/pwa-register.ts') },
      { find: /^firebase\/app$/, replacement: p('./scripts/manual-shots/shims/app.ts') },
      { find: /^firebase\/auth$/, replacement: p('./scripts/manual-shots/shims/auth.ts') },
      { find: /^firebase\/firestore$/, replacement: p('./scripts/manual-shots/shims/firestore.ts') },
      { find: /^(\.\.?\/)+firebase$/, replacement: p('./scripts/manual-shots/shims/firebase.ts') },
    ],
  },
  build: { outDir: '.manual-build', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
