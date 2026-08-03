import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'

import { Logo } from '@/ui/components/Logo'

/**
 * En-tête de l'application : logo + engrenage, rien d'autre.
 *
 * L'engrenage est l'entrée de `/settings` — 44 px de zone tactile, icône
 * `lucide` en `icon-dim`. Le sélecteur de langue qui vivait ici depuis le
 * temps 1 est mort : sa place définitive est la section `▸ PROFIL` des
 * Réglages, comme le prévoyait son commentaire de naissance.
 *
 * `sticky` plutôt que `fixed` : le contenu ne passe pas dessous, donc
 * aucune compensation de padding à maintenir dans chaque écran.
 */
export function Header() {
  const { t } = useTranslation()

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-tabbar px-5 py-2 backdrop-blur-lg">
      <Logo className="h-16" />
      <Link
        href="/settings"
        aria-label={t('settings.title')}
        className="flex h-11 w-11 items-center justify-center text-icon-dim transition-colors hover:text-accent"
      >
        <Settings size={20} strokeWidth={1.75} />
      </Link>
    </header>
  )
}
