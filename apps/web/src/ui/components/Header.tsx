import { LanguageSwitcher } from '@/ui/components/LanguageSwitcher'
import { Logo } from '@/ui/components/Logo'

/**
 * En-tête de l'application.
 *
 * Le handoff ne prévoit pas de header dans l'app : le logo n'apparaît que
 * sur la landing et sur l'écran de connexion, tous deux hors périmètre du
 * temps 1. Ce header existe donc pour porter le sélecteur de langue
 * pendant la construction, et il disparaîtra — ou se réduira au logo — le
 * jour où les réglages auront leur écran.
 *
 * `sticky` plutôt que `fixed` : le contenu ne passe pas dessous, donc
 * aucune compensation de padding à maintenir dans chaque écran.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-tabbar px-5 py-3 backdrop-blur-lg">
      <Logo className="text-base" />
      <LanguageSwitcher />
    </header>
  )
}
