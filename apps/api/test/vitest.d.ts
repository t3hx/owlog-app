/**
 * Ce que le `globalSetup` fournit aux tests via `provide`/`inject`.
 *
 * Fichier de déclaration séparé : une augmentation de module est une
 * syntaxe qui ressemble à un namespace, bannie des fichiers exécutés sous
 * `--experimental-strip-types` — un `.d.ts` n'est jamais exécuté.
 */
declare module 'vitest' {
  export interface ProvidedContext {
    /** URL d'administration du Postgres jetable, ou `null` sans Docker. */
    databaseAdminUrl: string | null
  }
}

export {}
