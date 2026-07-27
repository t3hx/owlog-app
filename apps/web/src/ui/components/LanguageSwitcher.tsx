import { useTranslation } from 'react-i18next'

import { LANGUAGES, type Language } from '@/i18n'

/**
 * Sélecteur de langue.
 *
 * **Temporaire.** Il ne figure dans aucun écran du handoff, et sa place
 * définitive est un écran de réglages qui n'existe pas encore. Il vit dans
 * le header le temps de pouvoir vérifier les deux catalogues d'un tap,
 * pendant la construction.
 *
 * Il n'écrit pas dans `settings` : `i18next` persiste le choix en
 * `localStorage`, qui est lisible de façon synchrone. Une lecture IndexedDB
 * ferait rendre l'interface une première fois dans la mauvaise langue.
 */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex items-center gap-1"
    >
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          onClick={() => void i18n.changeLanguage(language)}
          aria-pressed={current === language}
          className={
            current === language
              ? 'min-h-0 min-w-0 rounded-action border border-border-accent px-2 py-1 font-mono text-[10px] text-accent'
              : 'min-h-0 min-w-0 rounded-action border border-border px-2 py-1 font-mono text-[10px] text-subtle'
          }
        >
          {t(`language.${language}` as 'language.fr')}
        </button>
      ))}
    </div>
  )
}

export type { Language }
