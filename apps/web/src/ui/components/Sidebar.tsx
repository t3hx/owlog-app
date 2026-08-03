import { useTranslation } from 'react-i18next'
import { Link, useRoute } from 'wouter'

import { Logo } from '@/ui/components/Logo'
import { useSetting } from '@/ui/hooks/useSetting'
import { TABS, type Tab } from '@/ui/navigation'

/**
 * Navigation desktop — ce que devient la tab bar au-dela de 1024px.
 *
 * Valeurs relevees dans le mock 10a d'« Owlog Explorations.dc.html », pas
 * approximees : largeur 216px, fond `rgba(10,14,23,.9)`, filet a droite,
 * padding 26/16, items espaces de 4px, pastille utilisateur en bas.
 *
 * Le logo vit ici et nulle part ailleurs en desktop : le `Header` mobile est
 * masque au meme palier. Deux logos a l'ecran seraient une faute de design
 * system avant d'etre une faute de code.
 *
 * Les items sont ceux de `TABS` — la meme source que la tab bar. La
 * quatrieme case reste `log` : la decision D2.2 y installe « amis », mais
 * l'ecran Amis n'existe pas encore (T3H-64). Un onglet qui ouvre le vide est
 * pire qu'un onglet absent, c'est la regle inscrite dans `navigation.ts` — le
 * basculement se fera dans le lot qui livre l'ecran.
 */
export function Sidebar() {
  const { t } = useTranslation()

  return (
    <aside className="flex w-[216px] flex-none flex-col border-r border-border bg-sidebar px-4 py-[26px]">
      <Logo className="h-16 px-2.5" />

      <nav aria-label={t('nav.ariaLabel')} className="mt-[34px]">
        <ul className="flex flex-col gap-1">
          {TABS.map((tab) => (
            <li key={tab.path}>
              <SidebarLink tab={tab} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1" />

      <UserChip />
    </aside>
  )
}

function SidebarLink({ tab }: { tab: Tab }) {
  const { t } = useTranslation()
  const [active] = useRoute(tab.path)

  return (
    <Link
      href={tab.path}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'flex items-center gap-3 rounded-[10px] border border-border bg-surface px-2.5 py-[11px]'
          : 'flex items-center gap-3 rounded-[10px] border border-transparent px-2.5 py-[11px] transition-colors hover:border-border'
      }
    >
      <span
        aria-hidden
        className={
          active
            ? 'size-[18px] flex-none rounded-[5px] bg-gradient-action shadow-glow-sm'
            : 'size-[18px] flex-none rounded-[5px] border-[1.5px] border-icon-dim'
        }
      />
      <span
        className={
          active ? 'font-mono text-[11px] text-accent' : 'font-mono text-[11px] text-muted'
        }
      >
        {t(tab.labelKey)}
      </span>
    </Link>
  )
}

/**
 * Pastille utilisateur, en bas — l'entree des Reglages en desktop, la ou le
 * mobile passe par l'engrenage du header.
 *
 * Le mock affiche un `@pseudo` sous le prenom. Il n'est pas rendu : le
 * pseudo n'existe pas encore (T3H-63), et afficher une adresse inventee
 * serait mentir sur une identite. La ligne reviendra avec le champ.
 */
function UserChip() {
  const { t } = useTranslation()
  const { value: firstName } = useSetting('firstName')

  return (
    <Link
      href="/settings"
      aria-label={t('settings.title')}
      className="flex items-center gap-2.5 rounded-[10px] border border-border p-2.5 transition-colors hover:border-border-active"
    >
      <span
        aria-hidden
        className="flex size-[30px] flex-none items-center justify-center rounded-full border border-border-accent bg-surface-raised text-[11px] font-semibold text-accent"
      >
        {initial(firstName)}
      </span>
      <span className="truncate text-[12px] font-semibold">{firstName}</span>
    </Link>
  )
}

/**
 * L'initiale n'est pas `firstName[0]` : sur un prenom compose d'emoji ou de
 * caracteres hors du plan de base, l'indexation par unite UTF-16 coupe au
 * milieu d'une paire et rend un losange noir.
 */
function initial(firstName: string | undefined): string {
  return [...(firstName ?? '')][0]?.toUpperCase() ?? ''
}
