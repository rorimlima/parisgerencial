import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/*.png', 'icons/*.jpg', 'favicon.ico'],
        manifest: false, // usamos o arquivo manifest.webmanifest em /public
        workbox: {
          // Faz precache de todos os assets do build
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // NetworkFirst para chamadas ao Firebase/Firestore
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firestore-cache',
                networkTimeoutSeconds: 10,
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24, // 24 horas
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com\/.*/i,
              handler: 'NetworkOnly',
              options: {
                cacheName: 'firebase-auth-cache',
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-stylesheets',
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 ano
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
          // Aumenta limite de tamanho para precache (Firebase é grande)
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
          // Limpa caches antigos automaticamente
          cleanupOutdatedCaches: true,
          // Evita conflito com rotas do Firebase
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/functions\//],
          // Service Worker personalizado para skip waiting
          skipWaiting: true,
          clientsClaim: true,
        },
        devOptions: {
          // Habilita PWA em desenvolvimento para testar
          enabled: false,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    // Se o firebase não estiver instalado localmente, usa CDN como fallback
    optimizeDeps: {
      include: ['firebase/app', 'firebase/firestore', 'firebase/auth'],
    },
    build: {
      rollupOptions: {
        // Firebase é bundleado normalmente pelo Vite quando instalado
      },
    },
  };
});
