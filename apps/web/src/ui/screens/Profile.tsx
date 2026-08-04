import { posterUrl } from '@owlog/contracts'
import type { ProfileActivityLine, ProfileFavorite, PublicProfileView } from '@owlog/domain'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'

import type { SocialFailure } from '@/ports/SocialGateway'
import { RowPoster } from '@/ui/components/library/rowParts'
import { ActivityText } from '@/ui/components/social/ActivityText'
import { Avatar } from '@/ui/components/social/Avatar'
import { ProfileTile } from '@/ui/components/social/ProfileTile'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Écran Profil — écran 9 du handoff, états de `social.md` §2.
 *
 * **Ce que cet écran ne rend jamais : la carte minimale d'un non-ami.**
 * `social.md` §2 est explicite depuis la précision de T3H-63 — elle se rend
 * depuis la réponse de recherche qui a produit la rangée, sans second appel
 * réseau, et c'est cette rangée qui en porte les quatre éléments (avatar,
 * `@pseudo`, « membre depuis », `+ AJOUTER`). Un profil atteint autrement
 * que par la recherche — au clavier, par un lien — tombe donc sur
 * « introuvable », et c'est le comportement voulu : on n'accède à un profil
 * que par un chemin qui a déjà payé son rate-limit.
 *
 * Corollaire : `introuvable` couvre indistinctement le pseudo inconnu et le
 * non-ami. Le serveur refuse de les distinguer, l'écran aussi — les séparer
 * ici rouvrirait l'oracle d'énumération côté client.
 *
 * `embedded` distingue le panneau desktop de l'écran plein : le panneau n'a
 * pas de flèche de retour, puisque la liste reste visible à côté.
 */
export function Profile({
  pseudo,
  embedded = false,
}: {
  readonly pseudo: string
  readonly embedded?: boolean
}) {
  const { social } = usePorts()
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly view: PublicProfileView }
    | { readonly status: 'failed'; readonly failure: SocialFailure }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    void social.profile(pseudo).then((result) => {
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', view: result.value }
          : { status: 'failed', failure: result.failure },
      )
    })

    return () => {
      cancelled = true
    }
  }, [social, pseudo])

  if (state.status === 'loading') return <Frame embedded={embedded} />

  if (state.status === 'failed') {
    return (
      <Frame embedded={embedded}>
        <Trouble failure={state.failure} />
      </Frame>
    )
  }

  return (
    <Frame embedded={embedded}>
      <Body view={state.view} />
    </Frame>
  )
}

function Frame({
  embedded,
  children,
}: {
  readonly embedded: boolean
  readonly children?: React.ReactNode
}) {
  const { t } = useTranslation()

  if (embedded) {
    return <div className="flex flex-col gap-4">{children}</div>
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pb-8 pt-5 lg:px-0 lg:pt-0">
      <Link
        href="/friends"
        aria-label={t('friends.back')}
        className="flex size-9 items-center justify-center rounded-tag border border-border-active bg-tabbar text-[16px] text-text"
      >
        ←
      </Link>
      {children}
    </div>
  )
}

/**
 * Le profil complet.
 *
 * La branche `minimal` existe dans le type mais pas dans cette route : le
 * serveur ne la sert jamais ici (404 à la place). Elle est traitée quand
 * même — un `switch` exhaustif sur une union discriminée coûte trois lignes
 * et survit à un changement de politique côté serveur, là où un cast
 * produirait un écran blanc.
 */
function Body({ view }: { readonly view: PublicProfileView }) {
  const { t } = useTranslation()

  if (view.kind === 'minimal') {
    return (
      <Header pseudo={view.pseudo} memberSince={view.memberSince} loggedCount={null} />
    )
  }

  return (
    <>
      <Header
        pseudo={view.pseudo}
        memberSince={view.memberSince}
        loggedCount={view.loggedCount}
      />

      <div className="flex gap-2.5">
        <ProfileTile value={view.seenCount} label={t('profile.seen')} tone="seen" />
        <ProfileTile value={view.favoriteCount} label={t('profile.favorites')} tone="favorite" />
        {/* Pas de tuile compat sur son propre profil : la compatibilité avec
            soi-même n'a pas de sens. La règle est portée par le type —
            `OwnProfile` n'a pas de champ `compat` — donc aucun écran ne peut
            la rendre par accident. */}
        {view.kind === 'friend' && (
          <ProfileTile
            value={view.compat === null ? '—' : `${view.compat}%`}
            label={t('profile.compat')}
            tone="compat"
          />
        )}
      </div>

      <Favorites favorites={view.favorites} />
      <Activity activity={view.activity} />
    </>
  )
}

function Header({
  pseudo,
  memberSince,
  loggedCount,
}: {
  readonly pseudo: string
  readonly memberSince: string
  readonly loggedCount: number | null
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center gap-1">
      <Avatar pseudo={pseudo} size="profile" />
      <p className="mt-3 font-display text-[21px] font-semibold text-text">@{pseudo}</p>
      <p className="font-mono text-[10px] text-muted">
        {loggedCount === null
          ? t('friends.memberSince', { date: memberSince.slice(0, 10) })
          : t('profile.since', { date: memberSince.slice(0, 10), count: loggedCount })}
      </p>
    </div>
  )
}

/** `▸ SES COUPS DE CŒUR` — affiches liserées dégradé, comme partout ailleurs. */
function Favorites({ favorites }: { readonly favorites: readonly ProfileFavorite[] }) {
  const { t } = useTranslation()

  if (favorites.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[13px] font-semibold tracking-wide text-muted">
        {t('profile.favoritesSection')}
      </h2>
      <div className="flex gap-3 overflow-x-auto">
        {favorites.map((favorite) => (
          <div key={favorite.ref} className="flex w-24 flex-none flex-col gap-1.5">
            {/* `favorite` est vrai par construction : cette section n'affiche
                que des coups de cœur, et le liseré dégradé est leur marqueur
                partout dans l'app. */}
            <RowPoster
              src={posterUrl(favorite.posterPath, 'w185')}
              favorite
              shape="h-36 w-24 rounded-poster"
              innerRadius="rounded-poster"
              width={96}
              height={144}
            />
            <span className="truncate text-[11.5px] font-medium text-text">
              {favorite.title ?? t('home.uncached')}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * `▸ ACTIVITÉ` — le journal, filtré par la projection.
 *
 * Vide, la section ne disparaît pas : elle le dit. Un ami tout neuf n'a
 * rien fait, ce qui est une information ; une section fantôme laisserait
 * croire à un défaut de chargement.
 */
function Activity({ activity }: { readonly activity: readonly ProfileActivityLine[] }) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-display text-[13px] font-semibold tracking-wide text-muted">
        {t('profile.activitySection')}
      </h2>

      {activity.length === 0 ? (
        <p className="font-mono text-[10.5px] text-subtle">{t('profile.activityEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-2 border-l border-border pl-3.5">
          {activity.map((line) => (
            <p
              key={`${line.ref}-${line.at ?? ''}-${line.type}`}
              className="font-mono text-[10.5px] text-muted"
            >
              <ActivityText activity={line} withDate />
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Introuvable — et jamais un cul-de-sac.
 *
 * Aux codes de `Welcome` : eyebrow mono, une phrase, un CTA outline qui
 * ramène à la liste. Le même écran pour un pseudo inconnu et pour un
 * non-ami : c'est la règle « privé = inexistant », rendue visible.
 */
function Trouble({ failure }: { readonly failure: SocialFailure }) {
  const { t } = useTranslation()

  const message =
    failure.kind === 'offline'
      ? t('friends.offline')
      : failure.kind === 'notFound'
        ? t('profile.unknown')
        : t('friends.unavailable')

  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="font-mono text-[10px] tracking-wide text-accent">{t('friends.eyebrow')}</p>
      <p className="font-display text-[21px] font-semibold text-text">{message}</p>
      <Link
        href="/friends"
        className="flex items-center justify-center rounded-action border border-border-active px-5 font-mono text-[11px] text-muted"
      >
        {t('profile.backToFriends')}
      </Link>
    </div>
  )
}
