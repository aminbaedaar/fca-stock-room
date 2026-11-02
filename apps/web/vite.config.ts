import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Tauri sets TAURI_ENV_PLATFORM while building the desktop app.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      disable: isTauri,
      includeAssets: ['logo-mark.png', 'logo-full.png'],
      manifest: {
        name: 'FCA Stock Room',
        short_name: 'Stock Room',
        description: 'Stock management for First Choice Africa Limited',
        theme_color: '#601E62',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        importScripts: ['push-sw.js'],
        navigateFallbackDenylist: [/^\/auth/],
      },
    }),
  ],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2021', chunkSizeWarningLimit: 1500 },
});
