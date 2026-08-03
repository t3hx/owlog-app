import { defineConfig } from 'vitest/config'

/**
 * Le domaine est pur : fonctions sur des listes d'événements, aucun DOM,
 * aucune IndexedDB. L'environnement `node` suffit — c'est aussi ce qui
 * garantit qu'aucune dépendance navigateur ne s'y glisse par accident.
 */
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
