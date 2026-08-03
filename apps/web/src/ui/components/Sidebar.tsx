import { useTranslation } from 'react-i18next'
import { Link, useRoute } from 'wouter'

import { Logo } from '@/ui/components/Logo'
import { useSetting } from '@/ui/hooks/useSetting'
import { avatarInitial } from '@/ui/identity'
import { TABS, type Tab } from '@/ui/navigation'
import { useSession } from '@/ui/session/SessionProvider'

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
      {/* Centré, pas aligné à gauche comme les items de nav : le wordmark du
          mock remplit la colonne, l'image est presque carrée (888 × 903) et
          laisse un vide à droite dès qu'on la cale sur le bord. */}
      <Logo className="mx-auto h-28" />

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
 * Le mock affiche un `@pseudo` sous le prenom, et il est rendu depuis
 * T3H-63 — quand il existe. Sans pseudo, la ligne est absente plutot que
 * remplie d'une adresse inventee : mentir sur une identite serait pire que
 * de ne rien dire.
 *
 * **L'initiale sort du pseudo, jamais du prenom** (`social.md` §3, un seul
 * systeme d'avatar). Le repli sur le prenom ne vaut que pour sa propre
 * pastille avant qu'un pseudo n'existe — voir `avatarInitial`.
 */
function UserChip() {
  const { t } = useTranslation()
  const { value: firstName } = useSetting('firstName')
  const session = useSession()
  const pseudo = session.user?.pseudo ?? null

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
        {avatarInitial(pseudo, firstName)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] font-semibold">{firstName}</span>
        {pseudo !== null && (
          <span className="truncate font-mono text-[10px] text-muted">@{pseudo}</span>
        )}
      </span>
    </Link>
  )
}
