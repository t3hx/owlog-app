import { Link, useRoute } from 'wouter'

import { TABS, type Tab } from '@/ui/navigation'

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
 * Le prototype rend le quatrième onglet en cercle parce que c'était « amis »,
 * donc un avatar. Le quatrième onglet est ici « log » : il reste carré.
 *
 * `env(safe-area-inset-bottom)` : sur iPhone, la barre système mange le bas
 * de l'écran. Sans ça, le dernier onglet devient difficile à atteindre.
 */
export function TabBar() {
  return (
    <nav
      aria-label="Navigation principale"
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
  const [actif] = useRoute(tab.path)

  return (
    <Link
      href={tab.path}
      aria-current={actif ? 'page' : undefined}
      className="flex h-14 flex-col items-center justify-center gap-1.5"
    >
      <span
        aria-hidden
        className={
          actif
            ? 'size-[22px] rounded-[6px] bg-gradient-action shadow-glow-sm'
            : 'size-[22px] rounded-[6px] border-[1.5px] border-icon-dim'
        }
      />
      <span
        className={
          actif
            ? 'font-mono text-[9px] tracking-wide text-accent'
            : 'font-mono text-[9px] tracking-wide text-muted'
        }
      >
        {tab.label}
      </span>
    </Link>
  )
}
