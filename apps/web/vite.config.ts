import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Configuration Vite de l'application web.
 *
 * SPA pure, sans rendu serveur : l'app est mono-utilisateur et local-first
 * au temps 1, il n'y a rien à rendre côté serveur, et le SSR entrerait en
 * conflit avec le service worker qui precache un shell statique.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt` et non `autoUpdate` : recharger la page sous les doigts de
      // quelqu'un qui saisit un titre lui ferait perdre sa frappe.
      registerType: 'prompt',
      injectRegister: null,

      manifest: {
        name: 'Owlog',
        short_name: 'Owlog',
        description: 'Tout ce que tu regardes. Un seul log.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#070a12',
        theme_color: '#070a12',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Les polices entrent dans le precache. Sans elles, la première
        // ouverture hors-ligne retombe en polices système et la conformité
        // au design est perdue — défaut invisible tant qu'on est en ligne.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],

        // Mode history : toute route inconnue sert `index.html`, hors-ligne
        // comme en ligne. C'est le pendant du rewrite SPA du Caddyfile.
        navigateFallback: '/index.html',

        // Sauf `/api`, qui est owlog-api servi sur la même origine. Les
        // appels du client sont des `fetch`, que ce repli n'intercepte pas ;
        // c'est la navigation directe qui pose problème. Sans cette
        // exception, ouvrir `/api/health` dans le navigateur affiche
        // l'application — `curl` répond correctement, le navigateur ment, et
        // on cherche la panne du mauvais côté.
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          {
            // Les affiches TMDB. `CacheFirst` parce qu'une affiche ne change
            // jamais pour une URL donnée : elle est immuable par nature.
            urlPattern: /^https:\/\/image\.tmdb\.org\/t\/p\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: {
                // Borné volontairement. Les réponses d'images gonflent le
                // quota d'origine, et le dépasser déclencherait l'éviction
                // d'IndexedDB — c'est-à-dire la perte du journal.
                maxEntries: 300,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
