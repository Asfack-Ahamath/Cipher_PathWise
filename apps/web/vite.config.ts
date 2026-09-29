import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'PathWise — Waypoint Group',
        short_name: 'PathWise',
        description: 'Delivery planning, loading, driving and receipt for Waypoint Group.',
        theme_color: '#0F766E',
        background_color: '#F4F6FA',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // the app shell works with no signal; API calls are never served stale by the service worker —
        // the driver app keeps its own copy of the run and an outbox instead
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 20 } } },
          { urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/.*/, handler: 'CacheFirst', options: { cacheName: 'tiles', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14 } } },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': { target: API, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
