import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ระบบจัดการสต็อกยา OPD — PWA config
// - รองรับ offline: precache app shell ด้วย workbox, ข้อมูล/ธุรกรรมพึ่งพา Firestore offline persistence (ดู src/firebase.js)
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'จัดการสต็อกยา OPD',
        short_name: 'สต็อกยา OPD',
        description: 'ระบบจัดการสต็อกยาห้องยาผู้ป่วยนอก: Substock → หน้างานจ่ายยา พร้อม FEFO, แจ้งเตือน reorder และ audit trail',
        theme_color: '#0d9488',
        background_color: '#f4f6f5',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'th',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // อย่า cache คำขอไป Firestore/Auth ผ่าน workbox — ปล่อยให้ Firestore SDK จัดการ offline persistence เอง
        navigateFallbackDenylist: [/^\/__\/auth/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('firestore.googleapis.com') ||
              url.hostname.includes('identitytoolkit.googleapis.com'),
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // แยก firebase (ก้อนใหญ่สุด) ออกจาก vendor อื่น ๆ ให้ cache แยกกันได้ยาวขึ้น
        // ไม่ได้ลดขนาดรวม แต่ช่วยให้ browser cache ก้อนที่ไม่ค่อยเปลี่ยน (firebase) ข้ามการ deploy โค้ดแอปได้
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions']
        }
      }
    }
  },
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  }
})
