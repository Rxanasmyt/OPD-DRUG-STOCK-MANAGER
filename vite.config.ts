import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from a GitHub Pages project site (https://<user>.github.io/<repo>/), so
// asset URLs need the repo name as a base path. Local dev still runs at "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? '/OPD-DRUG-STOCK-MANAGER/' : '/',
});
