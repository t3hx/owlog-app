/// <reference types="vite/client" />

/**
 * Variables injectées au build.
 *
 * Elles sont publiques : tout ce qui porte le préfixe `VITE_` finit dans le
 * bundle. Aucun secret ne passe par ici — la clé TMDB ne quitte jamais
 * `owlog-api`.
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_SHARED_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
