import { backdropUrl, posterUrl } from '@owlog/contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import {
  journal as journalOf,
  applyTaps,
  episodeIncrement,
  episodesFromPercent,
  hasEpisodes,
  upcomingEpisodeLabel,
  upcomingEpisodeNumber,
  upcomingEpisodeRank,
  type MediaRef,
  type StoredEvent,
} from '@owlog/domain'
import { ProgressBar } from '@/ui/components/home/ProgressBar'
import { EventText } from '@/ui/components/journal/EventText'
import { StatusMenu } from '@/ui/components/library/StatusMenu'
import { STATUS_CHIP, STATUSES } from '@/ui/components/status/statusStyle'
import { useDesktop } from '@/ui/hooks/useDesktop'
import { useEpisodeTitle } from '@/ui/hooks/useEpisodeTitle'
import { useLongPress } from '@/ui/hooks/useLongPress'
import { useMedia } from '@/ui/hooks/useMedia'
import { usePlay } from '@/ui/hooks/usePlay'

/**
 * Page média.
 *
 * Recréation du prototype `Owlog Prototype.dc.html` : backdrop 16:9 fondu
 * vers le fond, affiche 96×144 en surimpression, chips de statut, étoiles,
 * toggle ♥, bouton `↻ REVOIR` sur un titre vu, puis le journal groupé par
 * visionnage.
 *
 * L'emplacement Letterboxd du handoff est retiré : il n'a pas d'API publique
 * de notes, et un emplacement vide annonce une fonctionnalité qui ne viendra
 * pas. Seul `tmdb` s'affiche.
 */
export function Media({ ref: mediaRef }: { ref: MediaRef }) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const media = useMedia(mediaRef)
  const { tap, pendingTaps, markSeen } = usePlay()
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)

  const { state, cache, journal } = media
  const desktop = useDesktop()
  const status = state?.status ?? 'absent'
  const poster = posterUrl(cache?.posterPath ?? null, 'w342')
  const backdrop = backdropUrl(cache?.backdropPath ?? null, 'w780')

  // Même projection optimiste que l'accueil : le CTA « épisode suivant »
  // avance au tap, l'écriture est regroupée par `usePlay`.
  const increment = episodeIncrement(cache?.numberOfEpisodes)
  const projection = applyTaps(
    { percent: state?.percent ?? 0, label: state?.label ?? null },
    pendingTaps(mediaRef),
    increment,
  )
  // Le dernier épisode vu du cycle courant : le label saisi, sinon le rang
  // déduit du pourcentage — la même matière que la rangée de l'accueil.
  const seenEpisodes = episodesFromPercent(projection.percent, cache?.numberOfEpisodes)
  const lastEpisodeSeen =
    projection.label ??
    (hasEpisodes(mediaRef) && seenEpisodes !== null && seenEpisodes > 0
      ? t('home.episodeCount', { seen: seenEpisodes, total: cache?.numberOfEpisodes })
      : null)
  const nextLabel = upcomingEpisodeLabel(projection.label)
  // Sans label saisi, la numérotation se déduit du pourcentage et du compte
  // d'épisodes : pas de saison affirmée, mais un rang.
  const nextNumber =
    nextLabel === null ? upcomingEpisodeNumber(projection.percent, cache?.numberOfEpisodes) : null

  // Titre de l'épisode suivant, seulement quand le CTA qui le porte existe.
  // Le rang décide aussi de l'appel réseau : `null` = rien demandé — et le
  // hook se tait sur tout échec, hors-ligne compris.
  const nextRank =
    status === 'watching' && hasEpisodes(mediaRef)
      ? upcomingEpisodeRank(nextLabel, nextNumber, cache?.numberOfSeasons)
      : null
  const nextEpisodeTitle = useEpisodeTitle(mediaRef, nextRank)

  /**
   * Le CTA plein, unique et exclusif par statut — jamais deux à la fois.
   *
   * « vu » propose REVOIR ; « en cours » propose le geste du play adaptatif,
   * épisode suivant sur un média à épisodes, marquer vu sur un film. Les
   * autres statuts n'en ont aucun.
   *
   * Comme le journal, c'est un seul nœud monté à deux endroits : dans la
   * rangée des notes en desktop (le mock 10c y aligne étoiles, ♥, CTA et note
   * externe), sous elle en mobile où la ligne est déjà pleine.
   */
  const cta =
    status === 'seen' ? (
      <ActionCta
        icon="↻"
        label={t('media.rewatch')}
        onTap={() => void media.watchAgain()}
        desktop={desktop}
      />
    ) : status === 'watching' ? (
      hasEpisodes(mediaRef) ? (
        <ActionCta
          icon="▸"
          // Trois niveaux de précision, du plus dit au plus déduit : le label
          // saisi (`S02E06`), le rang déduit du pourcentage (`ÉP. 4`), puis
          // rien quand on ne sait rien.
          label={
            nextLabel !== null
              ? t('media.nextEpisode', { label: nextLabel })
              : nextNumber !== null
                ? t('media.nextEpisodeNumber', { number: nextNumber })
                : t('media.nextEpisodeUnknown')
          }
          onTap={() => tap(mediaRef, increment)}
          desktop={desktop}
        />
      ) : (
        <ActionCta
          icon="✓"
          label={t('media.markSeen')}
          onTap={() => void markSeen(mediaRef)}
          desktop={desktop}
        />
      )
    ) : null

  /**
   * Le journal, monté à deux endroits selon le format.
   *
   * En mobile il ferme la colonne, sous les genres. Au-delà de 1024px il
   * devient le panneau latéral de 330px du mock 10c : la fiche et son
   * histoire se lisent alors ensemble, sans défilement de l'une pour
   * atteindre l'autre. C'est le même nœud, jamais deux rendus à maintenir.
   */
  const journalBlock = (
    <>
      <h2
        className={
          desktop
            ? 'mb-3 font-display text-[13px] font-semibold tracking-wide text-muted'
            : 'mb-2.5 mt-6 font-display text-[13px] font-semibold tracking-wide text-muted'
        }
      >
        {t('media.journal')}
      </h2>

      {/* Ligne synthétique du cycle en cours — arbitrage utilisateur du
          2026-08-01 (option A) : les PROG restent exclus du journal (le
          journal raconte les cycles), mais le dernier épisode vu se lit
          ici, dérivé de la projection — une ligne, pas cinquante. */}
      {status === 'watching' && lastEpisodeSeen !== null && (
        <p className="mb-2 border-l border-border pl-2.5 font-mono text-[10.5px] text-muted">
          {t('media.journalLastEpisode', { label: lastEpisodeSeen })}
        </p>
      )}

      <Journal entries={journalOf(journal)} onCancel={(id) => void media.cancel(id)} />
    </>
  )

  return (
    <div className={desktop ? '-mx-10 -mt-7 pb-8' : 'mx-auto max-w-md px-4 pb-8'}>
      {/* Coins arrondis dès le mobile : le prototype cadre le backdrop en
          carte (rayon 14, léger retrait du haut), pas en pleine largeur.
          En desktop le mock 10c le veut pleine largeur sur 250px — d'où la
          sortie des marges du shell, qui n'a pas à connaître cet écran. */}
      <div
        className={
          desktop
            ? 'relative h-[250px] overflow-hidden'
            : 'relative mt-1.5 h-[190px] overflow-hidden rounded-card'
        }
      >
        {backdrop ? (
          <img src={backdrop} alt="" crossOrigin="anonymous" className="size-full object-cover" />
        ) : (
          <div className="size-full bg-poster-placeholder" />
        )}

        {/* Le fondu vers le fond, pour que l'affiche en surimpression se
            détache sans bordure — c'est la règle du handoff. */}
        <div className="absolute inset-0 bg-backdrop-fade" />

        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label={t('media.back')}
          className="absolute left-3.5 top-3.5 flex size-9 min-h-0 min-w-0 items-center justify-center rounded-tab border border-border-active bg-tabbar text-base text-text"
        >
          ←
        </button>

        {/* Pendant droit du ← : mêmes 36 px, même habillage. Il ouvre le
            menu de choix direct de statut — la même feuille que l'appui
            long de la pastille en bibliothèque, aucune surface inventée. */}
        <button
          type="button"
          onClick={() => setStatusMenuOpen(true)}
          aria-label={t('media.statusMenu')}
          className="absolute right-3.5 top-3.5 flex size-9 min-h-0 min-w-0 items-center justify-center rounded-tab border border-border-active bg-tabbar text-base text-text"
        >
          ⋯
        </button>
      </div>

      <div className={desktop ? 'flex gap-10 px-10' : undefined}>
      <div className={desktop ? 'min-w-0 flex-1' : undefined}>

      <div
        className={
          desktop
            ? 'relative -mt-[72px] flex items-end gap-6'
            : 'relative -mt-14 flex items-end gap-4 px-1.5'
        }
      >
        <Poster src={poster} favorite={state?.favorite ?? false} desktop={desktop} />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
          <h1
            className={
              desktop
                ? 'font-display text-[30px] font-semibold leading-[1.1] text-text'
                : 'font-display text-[21px] font-semibold leading-[1.15] text-text'
            }
          >
            {cache?.title ?? mediaRef}
          </h1>
          <p className="font-mono text-[10.5px] text-muted">{meta(cache, state, t)}</p>
        </div>

        {cache?.kind === 'tv' && (
          <SeasonsTile
            seasons={cache.numberOfSeasons ?? null}
            episodes={cache.numberOfEpisodes}
          />
        )}
      </div>

      {statusMenuOpen && (
        <StatusMenu
          title={cache?.title ?? mediaRef}
          current={status}
          onPick={(target) => {
            setStatusMenuOpen(false)
            void media.pickStatus(target)
          }}
          onClose={() => setStatusMenuOpen(false)}
        />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => void media.pickStatus(option)}
            aria-pressed={status === option}
            className={[
              'flex-none whitespace-nowrap rounded-full border px-[13px] py-2 font-mono text-[10.5px]',
              status === option ? STATUS_CHIP[option].on : STATUS_CHIP[option].off,
            ].join(' ')}
          >
            {t(`status.${option}` as 'status.to-watch')}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Stars value={state?.rating ?? null} onPick={(value) => void media.setRating(value)} />

        <span className="font-mono text-[10px] text-muted">
          {state?.rating === null || state?.rating === undefined
            ? t('media.noRating')
            : t('media.rating', { rating: state.rating })}
        </span>

        <button
          type="button"
          onClick={() => void media.toggleFav()}
          aria-label={t('media.favorite')}
          aria-pressed={state?.favorite ?? false}
          className="flex size-11 items-center justify-center text-[21px]"
        >
          {state?.favorite ? (
            <span className="text-gradient-action">♥</span>
          ) : (
            <span className="text-icon-dim">♡</span>
          )}
        </button>

        {desktop && cta}

        {cache?.externalRatings.tmdb != null && (
          <span className="ml-auto font-mono text-[10px] text-subtle">
            {t('media.tmdb', { rating: cache.externalRatings.tmdb.toFixed(1) })}
          </span>
        )}
      </div>

      {/* La barre d'avancement, la même que l'accueil : elle ne s'affiche
          que sur un titre en cours qui a réellement avancé — à 0 % elle
          n'apprend rien que les chips ne disent déjà. */}
      {status === 'watching' && projection.percent > 0 && (
        <div className="mt-3 max-w-[420px]">
          <ProgressBar percent={projection.percent} />
        </div>
      )}

      {/* En desktop le CTA est déjà monté dans la rangée des notes. Ne reste
          ici que ce qui le commente — le rang du prochain visionnage, le
          titre de l'épisode visé. */}
      {!desktop && cta}

      {status === 'seen' && (
        <p className="mt-2 font-mono text-[9.5px] text-subtle">
          {t('media.rewatchHint', { number: (state?.seenCount ?? 0) + 1 })}
        </p>
      )}

      {/* Le titre de l'épisode que le CTA désigne — « Le retour » — quand la
          saison est sue et le réseau d'accord. Absent sinon, sans
          placeholder : rien n'est dû ici. */}
      {status === 'watching' && hasEpisodes(mediaRef) && nextEpisodeTitle !== null && (
        <p className="mt-2 font-mono text-[10px] text-muted">
          {t('media.nextEpisodeTitle', { title: nextEpisodeTitle })}
        </p>
      )}

      {cache?.overview && (
        <p className="mt-[18px] max-w-[620px] text-[13.5px] leading-[1.55] text-muted">
          {cache.overview}
        </p>
      )}

      {cache && cache.genres.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {cache.genres.map((genre) => (
            <span
              key={genre}
              className="rounded-tag border border-border px-2.5 py-1 font-mono text-[9.5px] text-muted"
            >
              {genre}
            </span>
          ))}
        </div>
      )}

      {!desktop && journalBlock}

      </div>

      {desktop && (
        <aside className="w-[330px] flex-none pt-6">
          <div className="rounded-card border border-border bg-surface-translucent p-5">
            {journalBlock}
          </div>
        </aside>
      )}
      </div>
    </div>
  )
}

/**
 * Le CTA plein de la fiche : 44 px, dégradé et glow, pleine largeur.
 *
 * Un seul composant pour REVOIR, ÉPISODE SUIVANT et MARQUER VU : la
 * géométrie et les tokens du handoff n'existent qu'ici, et l'exclusivité —
 * jamais deux CTA pleins — se lit dans le rendu par statut, pas dans trois
 * boutons recopiés qui pourraient diverger.
 */
function ActionCta({
  icon,
  label,
  onTap,
  desktop,
}: {
  icon: string
  label: string
  onTap: () => void
  desktop: boolean
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      // Pleine largeur en mobile, ou le pouce vise une bande ; ajuste au
      // contenu en desktop (mock 10c : `padding: 0 26px`), ou une barre de
      // 420px au milieu d'une colonne large ne se lit plus comme un bouton.
      className={
        desktop
          ? 'mt-4 flex h-11 w-fit items-center justify-center gap-2.5 rounded-action bg-gradient-action px-[26px] shadow-glow-strong'
          : 'mt-4 flex h-11 w-full max-w-[420px] items-center justify-center gap-2.5 rounded-action bg-gradient-action shadow-glow-strong'
      }
    >
      <span className="text-base text-bg">{icon}</span>
      <span className="font-display text-[13px] font-semibold tracking-wide text-bg">{label}</span>
    </button>
  )
}

/**
 * Encart saisons/épisodes, à droite du titre d'une série.
 *
 * Carte du système (surface translucide, bordure, rayon 14) en deux lignes
 * empilées — chiffre en Chakra Petch, mot en mono éteint. Chaque ligne ne
 * s'affiche que si sa valeur est connue : les lignes de cache écrites avant
 * `numberOfSeasons` n'ont que le compte d'épisodes, et un « ? saisons »
 * annoncerait un manque là où il n'y a rien à attendre. Deux inconnues :
 * pas d'encart du tout — le composant rend `null`.
 */
function SeasonsTile({ seasons, episodes }: { seasons: number | null; episodes: number | null }) {
  const { t } = useTranslation()

  if (seasons === null && episodes === null) return null

  return (
    <div className="mb-1 flex flex-none flex-col gap-0.5 rounded-card border border-border bg-surface-translucent px-2.5 py-1.5">
      {seasons !== null && (
        <p className="whitespace-nowrap">
          <span className="font-display text-[13px] font-semibold text-text">{seasons}</span>{' '}
          <span className="font-mono text-[9.5px] text-muted">
            {t('media.seasonsWord', { count: seasons })}
          </span>
        </p>
      )}
      {episodes !== null && (
        <p className="whitespace-nowrap">
          <span className="font-display text-[13px] font-semibold text-text">{episodes}</span>{' '}
          <span className="font-mono text-[9.5px] text-muted">
            {t('media.episodesWord', { count: episodes })}
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * Affiche 96×144.
 *
 * Le liseré dégradé du coup de cœur se fait en double fond — `padding-box`
 * pour l'image, `border-box` pour le dégradé — parce qu'une bordure ne peut
 * pas porter de dégradé directement. C'est la technique du handoff, et le
 * seul endroit non-action autorisé à utiliser le dégradé.
 */
function Poster({
  src,
  favorite,
  desktop,
}: {
  src: string | null
  favorite: boolean
  desktop: boolean
}) {
  // 150x225 et rayon 12 en desktop (mock 10c), 96x144 et rayon 10 en mobile.
  const shape = desktop
    ? 'h-[225px] w-[150px] flex-none rounded-[12px] object-cover shadow-poster'
    : 'h-36 w-24 flex-none rounded-poster object-cover shadow-poster' 

  if (!favorite) {
    return src ? (
      <img src={src} alt="" crossOrigin="anonymous" className={shape} />
    ) : (
      <span className={`${shape} bg-poster-placeholder`} />
    )
  }

  return (
    <span className={`${shape} border-gradient shadow-glow`}>
      {src ? (
        <img src={src} alt="" crossOrigin="anonymous" className="size-full rounded-[9px] object-cover" />
      ) : (
        <span className="block size-full rounded-[9px] bg-poster-placeholder" />
      )}
    </span>
  )
}

/** Cinq étoiles tapables. Re-tap sur la même efface, c'est la règle du handoff. */
function Stars({
  value,
  onPick,
}: {
  value: number | null
  onPick: (value: number | null) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onPick(value === star ? null : star)}
          aria-label={t('media.star', { count: star })}
          className={[
            // Le socle impose 44 px a tout bouton. Le handoff donne aux
            // etoiles `padding:4px 2px` : cinq cibles de 44 px de large
            // feraient 220 px et pousseraient le reste de la rangee hors de
            // l'ecran. On garde la hauteur, on rend la largeur.
            'min-h-11 min-w-0 px-0.5 text-[22px] leading-none tracking-[2px]',
            value !== null && star <= value ? 'text-accent' : 'text-border-active',
          ].join(' ')}
        >
          ★
        </button>
      ))}
    </div>
  )
}

/**
 * Journal, groupé par visionnage.
 *
 * L'appui long annule l'entrée — c'est un `VOID`, jamais une suppression.
 * Le geste est volontairement long : sur un journal, un tap accidentel qui
 * effacerait une ligne serait le pire des défauts.
 */
function Journal({
  entries,
  onCancel,
}: {
  entries: ReturnType<typeof journalOf>
  onCancel: (id: string) => void
}) {
  const { t } = useTranslation()

  if (entries.length === 0) {
    return <p className="font-mono text-[10.5px] text-subtle">{t('media.journalEmpty')}</p>
  }

  return (
    <div className="flex max-w-[620px] flex-col gap-2 border-l border-border pl-3.5">
      {entries.map((entry) =>
        entry.kind === 'marker' ? (
          <p key={`m-${entry.cycle}`} className="font-mono text-[10px] text-subtle">
            {t('media.cycleMarker', { number: entry.number })}
          </p>
        ) : (
          <JournalLine key={entry.event.id} event={entry.event} onCancel={onCancel} />
        ),
      )}
    </div>
  )
}

function JournalLine({
  event,
  onCancel,
}: {
  event: StoredEvent
  onCancel: (id: string) => void
}) {
  const longPress = useLongPress(() => onCancel(event.id))

  return (
    <button
      type="button"
      {...longPress}
      className="min-h-0 min-w-0 text-left font-mono text-[10.5px] text-muted"
    >
      <EventText event={event} />
    </button>
  )
}

function meta(
  cache: ReturnType<typeof useMedia>['cache'],
  state: ReturnType<typeof useMedia>['state'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const parts = [
    cache?.year?.toString() ?? t('search.unknownYear'),
    t(cache?.kind === 'tv' ? 'search.kindSeries' : 'search.kindMovie'),
  ]

  if (state && state.seenCount > 0) parts.push(t('media.seenCount', { count: state.seenCount }))

  return parts.join(' · ')
}
