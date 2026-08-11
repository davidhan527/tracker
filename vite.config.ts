import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/tracker/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Rep Tracker',
        short_name: 'Reps',
        description: 'Log exercise reps — pushups, pullups, and more',
        start_url: '/tracker/',
        scope: '/tracker/',
        display: 'standalone',
        theme_color: '#111318',
        background_color: '#111318',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/tracker/index.html',
      },
    }),
  ],
})
