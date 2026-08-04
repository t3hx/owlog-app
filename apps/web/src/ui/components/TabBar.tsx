import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { isTabActive, TABS, type Tab } from '@/ui/navigation'

/**
 * Barre de navigation basse.
 *
 * Valeurs relevées dans `Owlog Prototype.dc.html` (objet `navDefs`), pas
 * approximées : fond `rgba(10,14,23,.92)` avec flou, labels en mono 9px,
 * icône de 22px à rayon 6px. Actif : dégradé menthe vers bleu, glow 10px,
 * label menthe. Inactif : bordure `1.5px solid #4d5468`, label `#8a8f9c`.
 *
 * La zone tactile fait 44px de haut même si le visuel en fait 22.
 *
 * Le quatrième onglet est « amis » (décision D2.2) et son icône est un
 * cercle, comme dans le prototype : un avatar, pas un écran. La forme vient
 * de `navigation.ts` — la déduire de la position se serait cassé au premier
 * réordonnancement.
 *
 * `env(safe-area-inset-bottom)` : sur iPhone, la barre système mange le bas
 * de l'écran. Sans ça, le dernier onglet devient difficile à atteindre.
 */
export function TabBar() {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t('nav.ariaLabel')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-tabbar backdrop-blur-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map((tab) => (
          <li key={tab.path} className="flex-1">
            <TabLink tab={tab} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

function TabLink({ tab }: { tab: Tab }) {
  const { t } = useTranslation()
  const [location] = useLocation()
  const active = isTabActive(tab, location)

  return (
    <Link
      href={tab.path}
      aria-current={active ? 'page' : undefined}
      className="flex h-14 flex-col items-center justify-center gap-1.5"
    >
      <span
        aria-hidden
        className={`size-[22px] ${tab.shape === 'round' ? 'rounded-full' : 'rounded-[6px]'} ${
          active ? 'bg-gradient-action shadow-glow-sm' : 'border-[1.5px] border-icon-dim'
        }`}
      />
      <span
        className={
          active
            ? 'font-mono text-[9px] tracking-wide text-accent'
            : 'font-mono text-[9px] tracking-wide text-muted'
        }
      >
        {t(tab.labelKey)}
      </span>
    </Link>
  )
}
