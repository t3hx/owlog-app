import type fr from '@/i18n/fr.json'

/**
 * Typage des clés de traduction.
 *
 * Le catalogue français fait référence : une clé absente ou mal orthographiée
 * échoue à la compilation plutôt que d'afficher son propre nom à l'écran.
 * C'est le même raisonnement que l'union fermée des clés de réglages — une
 * faute de frappe silencieuse coûte plus cher que la cérémonie de typage.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof fr }
  }
}
