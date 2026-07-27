import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Configuration Vite de l'application web.
 *
 * SPA pure, sans rendu serveur : l'app est mono-utilisateur et local-first au
 * temps 1, il n'y a rien à rendre côté serveur, et le SSR entrerait en conflit
 * avec le service worker qui precache un shell statique (étape 3 du plan).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
