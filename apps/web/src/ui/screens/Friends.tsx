import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'

import type { FriendSummary, IncomingRequest, SocialPerson } from '@owlog/contracts'

import type { SocialFailure } from '@/ports/SocialGateway'
import { ActivityText } from '@/ui/components/social/ActivityText'
import { isRecent } from '@/ui/components/social/Avatar'
import { SocialRow } from '@/ui/components/social/SocialRow'
import { useCircle } from '@/ui/hooks/useCircle'
import { useDesktop } from '@/ui/hooks/useDesktop'
import { usePorts } from '@/ui/PortsProvider'
import { Profile } from '@/ui/screens/Profile'
import { useSession } from '@/ui/session/SessionProvider'

/**
 * Écran Amis — écran 8 du handoff, états de `social.md` §1.
 *
 * L'ordre est celui du handoff et il est confirmé : **ajout, demandes,
 * amis**. L'actionnable d'abord ; la barre d'ajout est aussi le CTA de
 * l'état vide, ce qui évite d'inventer une illustration que le système
 * n'a pas.
 *
 * Trois états ne sont pas des erreurs et ne s'affichent pas comme telles :
 *
 * - **sans compte** — le social exige une session, mais l'onglet n'est
 *   jamais mort : il explique, aux codes de la card « activer la sync » ;
 * - **sans pseudo** — étape manquante, pas panne : l'écran emmène à la
 *   rangée `pseudo` de Réglages (`social.md` §3) ;
 * - **hors-ligne** — même politique que la recherche média : on dit qu'on
 *   ne sait pas, on ne sert pas une liste périmée.
 *
 * `selected` sert la vue master-detail du desktop : la rangée ouverte dans
 * le panneau droit se distingue dans la liste. Sur mobile, personne ne la
 * passe — la sélection y est un changement d'écran.
 */
export function Friends({ selected }: { readonly selected?: string } = {}) {
  const { t } = useTranslation()
  const session = useSession()
  const { state, reload } = useCircle()

  // Le gate de boot de la session : « pas encore su » n'est pas « pas de
  // compte », et les confondre ferait clignoter l'invitation à chaque
  // ouverture de l'onglet.
  if (session.loading) return <Shell />

  if (session.user === null || (state.status === 'failed' && state.failure.kind === 'signedOut')) {
    return (
      <Shell>
        <Invitation />
      </Shell>
    )
  }

  const pseudo = session.user.pseudo

  return (
    <Shell>
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-[25px] font-semibold text-text">{t('friends.title')}</h1>
        {state.status === 'ready' && (
          <p className="font-mono text-[11px] text-muted">
            {t('friends.count', { count: state.circle.friends.length })}
          </p>
        )}
      </header>

      {pseudo === null ? <PseudoNeeded /> : <AddByPseudo onChanged={() => void reload()} />}

      {state.status === 'failed' && <Trouble failure={state.failure} />}

      {state.status === 'ready' && (
        <Circle circle={state.circle} selected={selected} onAnswered={() => void reload()} />
      )}
    </Shell>
  )
}

/**
 * Le gabarit de l'écran.
 *
 * Même motif que les autres écrans : colonne centrée bornée en mobile, et
 * en desktop la colonne remplit ce qu'on lui donne — c'est le master-detail
 * qui borne alors, pas ce conteneur.
 */
function Shell({ children }: { readonly children?: React.ReactNode }) {
  const desktop = useDesktop()

  return (
    <div
      className={
        desktop
          ? 'flex flex-col gap-4'
          : 'mx-auto flex max-w-md flex-col gap-4 px-5 pb-8 pt-8'
      }
    >
      {children}
    </div>
  )
}

/**
 * L'écran Amis avec un profil ouvert.
 *
 * ```
 *   < 1024px   /friends/:pseudo  ──▶  le profil, plein écran
 *   ≥ 1024px   /friends/:pseudo  ──▶  la liste + le profil en panneau 430px
 * ```
 *
 * **Une seule route pour les deux formats**, et c'est ce qui rend la
 * continuité gratuite : traverser le palier en redimensionnant la fenêtre ne
 * change que le rendu, pas l'URL — la sélection et le scroll survivent parce
 * qu'il n'y a rien à retrouver. Deux routes auraient exigé de traduire l'une
 * en l'autre à chaque bascule.
 *
 * Un deep-link à 1280px ouvre donc directement la vue master-detail avec le
 * profil chargé, sans passage par la liste seule.
 */
export function FriendsWithProfile({ pseudo }: { readonly pseudo: string }) {
  const desktop = useDesktop()

  if (!desktop) return <Profile pseudo={pseudo} />

  return (
    <div className="flex gap-8">
      <div className="min-w-0 flex-1">
        <Friends selected={pseudo} />
      </div>
      <aside className="w-[430px] flex-none self-start rounded-card border border-border bg-surface-translucent p-7">
        <Profile pseudo={pseudo} embedded />
      </aside>
    </div>
  )
}

/** Sans compte : on explique, on ne barre pas la route. */
function Invitation() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-translucent p-5">
      <p className="font-mono text-[10px] tracking-wide text-accent">{t('friends.eyebrow')}</p>
      <h1 className="font-display text-[21px] font-semibold text-text">{t('friends.title')}</h1>
      <p className="text-sm text-muted">{t('friends.needAccount')}</p>
      <Link
        href="/login"
        className="flex items-center justify-center rounded-action bg-gradient-action px-6 font-display text-[13px] font-semibold tracking-wide text-bg shadow-glow-strong"
      >
        {t('settings.activateCta')}
      </Link>
    </div>
  )
}

/**
 * Sans pseudo : la rangée de Réglages est la destination, pas un message
 * d'erreur. C'est la seule chose qui manque, et elle se pose en un geste.
 */
function PseudoNeeded() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-translucent p-5">
      <p className="text-sm text-muted">{t('friends.needPseudo')}</p>
      <Link
        href="/settings"
        className="flex items-center justify-center rounded-action border border-border-accent px-6 font-mono text-[11px] text-accent"
      >
        {t('friends.needPseudoCta')}
      </Link>
    </div>
  )
}

type LookupState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching' }
  | { readonly status: 'found'; readonly person: SocialPerson }
  | { readonly status: 'failed'; readonly failure: SocialFailure }

/**
 * La barre « Ajouter par pseudo… @ ».
 *
 * Recherche **exacte, à la validation** — pas de filtrage à la frappe. Deux
 * raisons, et la seconde est la vraie : une requête par frappe consommerait
 * le plafond anti-énumération en trois mots, et surtout la recherche floue
 * est l'énumération elle-même. On cherche ici un pseudo qu'on a reçu, on ne
 * feuillette pas un annuaire.
 *
 * Le résultat vit dans l'état de cet écran, et c'est ce qui permet à la
 * carte minimale d'un non-ami de se rendre sans second appel réseau
 * (`social.md` §2).
 */
function AddByPseudo({ onChanged }: { readonly onChanged: () => void }) {
  const { t } = useTranslation()
  const { social } = usePorts()
  const [draft, setDraft] = useState('')
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const wanted = draft.trim().toLowerCase()
    if (wanted.length === 0) return

    setLookup({ status: 'searching' })
    const result = await social.search(wanted)
    setLookup(
      result.ok
        ? { status: 'found', person: result.value }
        : { status: 'failed', failure: result.failure },
    )
  }

  const ask = async (person: SocialPerson) => {
    const result = await social.request(person.pseudo)
    if (!result.ok) {
      setLookup({ status: 'failed', failure: result.failure })
      return
    }
    // L'état vit sur le bouton, jamais en toast : le serveur vient de dire
    // ce que la relation est devenue, on affiche exactement ça.
    setLookup({ status: 'found', person: { ...person, relation: result.value } })
    onChanged()
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={(event) => void submit(event)}>
        <label className="flex items-center gap-2.5 rounded-card border border-border-accent bg-surface px-3.5 py-3 shadow-search">
          <span aria-hidden className="relative size-4 flex-none rounded-full border-2 border-accent">
            <span className="absolute -bottom-[5px] -right-[3px] h-[7px] w-0.5 rotate-[-45deg] bg-accent" />
          </span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toLowerCase())}
            placeholder={t('friends.addPlaceholder')}
            aria-label={t('friends.addPlaceholder')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
      </form>

      {lookup.status === 'searching' && (
        <p className="font-mono text-[10px] text-subtle">{t('friends.searching')}</p>
      )}

      {lookup.status === 'failed' && <Trouble failure={lookup.failure} />}

      {lookup.status === 'found' && (
        <FoundRow person={lookup.person} onAdd={() => void ask(lookup.person)} />
      )}
    </div>
  )
}

/** Un résultat de recherche, et le seul geste qu'il offre. */
function FoundRow({
  person,
  onAdd,
}: {
  readonly person: SocialPerson
  readonly onAdd: () => void
}) {
  const { t } = useTranslation()

  return (
    <SocialRow
      pseudo={person.pseudo}
      detail={t('friends.memberSince', { date: person.memberSince.slice(0, 10) })}
      action={<RelationAction person={person} onAdd={onAdd} />}
    />
  )
}

function RelationAction({
  person,
  onAdd,
}: {
  readonly person: SocialPerson
  readonly onAdd: () => void
}) {
  const { t } = useTranslation()

  switch (person.relation) {
    case 'self':
      return <span className="font-mono text-[10px] text-subtle">{t('friends.itsYou')}</span>
    case 'friend':
      return (
        <Link
          href={`/friends/${person.pseudo}`}
          className="font-mono text-[10px] text-accent"
        >
          {t('friends.openProfile')}
        </Link>
      )
    case 'request-sent':
      // Inactif, et le rester : relancer une demande en cours n'apporte
      // rien à celui qui l'a envoyée et harcèle celui qui ne répond pas.
      return <span className="font-mono text-[10px] text-muted">{t('friends.requestSent')}</span>
    case 'request-received':
      return (
        <span className="font-mono text-[10px] text-status-watch">
          {t('friends.requestReceived')}
        </span>
      )
    default:
      return (
        <button
          type="button"
          onClick={onAdd}
          className="flex-none rounded-action bg-gradient-action px-5 font-display text-[13px] font-semibold tracking-wide text-bg shadow-glow-strong"
        >
          {t('friends.add')}
        </button>
      )
  }
}

/** Les deux listes de l'écran, dans l'ordre du handoff. */
function Circle({
  circle,
  selected,
  onAnswered,
}: {
  readonly circle: {
    readonly friends: readonly FriendSummary[]
    readonly incoming: readonly IncomingRequest[]
  }
  /** Requis mais nullable : sur mobile, personne n'est sélectionné. */
  readonly selected: string | undefined
  readonly onAnswered: () => void
}) {
  const { t } = useTranslation()

  return (
    <>
      {/* `▸ DEMANDES · N` disparaît à zéro : une section vide qui annonce
          « 0 » est du bruit. */}
      {circle.incoming.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-display text-[13px] font-semibold tracking-wide text-status-watch">
            {t('friends.requests', { count: circle.incoming.length })}
          </h2>
          {circle.incoming.map((request) => (
            <RequestRow key={request.pseudo} request={request} onAnswered={onAnswered} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="font-display text-[13px] font-semibold tracking-wide text-muted">
          {t('friends.section')}
        </h2>

        {circle.friends.length === 0 ? (
          <Empty />
        ) : (
          <>
            {circle.friends.map((friend) => (
              <FriendRow key={friend.pseudo} friend={friend} selected={selected === friend.pseudo} />
            ))}
            <p className="pt-1 text-center font-mono text-[10px] text-subtle">
              {t('friends.hint')}
            </p>
          </>
        )}
      </section>
    </>
  )
}

/**
 * Réseau vide : eyebrow, une phrase, et rien d'autre.
 *
 * La barre d'ajout en tête **est** le CTA — le handoff ne prévoit pas
 * d'illustration, et le système n'en a aucune à offrir.
 */
function Empty() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2 py-4">
      <p className="font-mono text-[10px] tracking-wide text-accent">{t('friends.eyebrow')}</p>
      <p className="text-sm text-muted">{t('friends.empty')}</p>
    </div>
  )
}

function RequestRow({
  request,
  onAnswered,
}: {
  readonly request: IncomingRequest
  readonly onAnswered: () => void
}) {
  const { t } = useTranslation()
  const { social } = usePorts()
  const [busy, setBusy] = useState(false)

  const answer = async (verdict: 'accept' | 'decline') => {
    setBusy(true)
    const result = verdict === 'accept'
      ? await social.accept(request.pseudo)
      : await social.decline(request.pseudo)
    setBusy(false)
    if (result.ok) onAnswered()
  }

  return (
    <SocialRow
      pseudo={request.pseudo}
      // La maquette écrit ici « 6 amis en commun » — un chiffre qu'aucune
      // route ne rend, et que `social.md` ne demande pas : la seconde ligne
      // d'une rangée porte « activité ou membre depuis ».
      detail={t('friends.memberSince', { date: request.memberSince.slice(0, 10) })}
      action={
        <span className="flex flex-none gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('accept')}
            aria-label={t('friends.accept')}
            className="size-11 flex-none rounded-action bg-gradient-action font-semibold text-bg disabled:opacity-50"
          >
            ✓
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('decline')}
            aria-label={t('friends.decline')}
            className="size-11 flex-none rounded-action border border-border-active text-subtle disabled:opacity-50"
          >
            ✕
          </button>
        </span>
      }
    />
  )
}

function FriendRow({
  friend,
  selected,
}: {
  readonly friend: FriendSummary
  readonly selected: boolean
}) {
  const { t } = useTranslation()
  const active = selected || isRecent(friend.activity?.at, Date.now())

  return (
    <Link href={`/friends/${friend.pseudo}`} className="block">
      <SocialRow
        pseudo={friend.pseudo}
        active={active}
        // Un ami tout neuf n'a rien à raconter : « membre depuis » plutôt
        // qu'une ligne vide, comme sur une rangée de demande.
        detail={
          friend.activity === null ? (
            t('friends.memberSince', { date: friend.memberSince.slice(0, 10) })
          ) : (
            <ActivityText activity={friend.activity} />
          )
        }
        action={
          <span className="flex-none font-mono text-[10px] text-muted">
            {friend.compat === null
              ? t('friends.compatUnknown')
              : t('friends.compat', { value: friend.compat })}
          </span>
        }
      />
    </Link>
  )
}

/**
 * Ce qui empêche la liste de s'afficher, dit en une ligne.
 *
 * `notFound` a son propre texte : c'est le seul cas où l'utilisateur a fait
 * quelque chose de juste — chercher — et où la réponse est simplement qu'il
 * n'y a personne. Et il est identique pour un pseudo inexistant et pour un
 * pseudo mal écrit : le serveur refuse de les distinguer, l'écran aussi.
 */
function Trouble({ failure }: { readonly failure: SocialFailure }) {
  const { t } = useTranslation()

  const message =
    failure.kind === 'notFound'
      ? t('friends.noAccount')
      : failure.kind === 'offline'
        ? t('friends.offline')
        : failure.kind === 'pseudoRequired'
          ? t('friends.needPseudo')
          : failure.kind === 'rateLimited'
            ? t('friends.rateLimited')
            : t('friends.unavailable')

  return (
    <p className="font-mono text-[10px] text-muted">
      <span aria-hidden className="text-subtle">
        !{' '}
      </span>
      {message}
    </p>
  )
}
