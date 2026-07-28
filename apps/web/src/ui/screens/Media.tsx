import { backdropUrl, posterUrl } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import { journal as journalOf } from '@/domain/reducers/journal'
import type { MediaRef, StoredEvent } from '@/domain/types'
import { EventText } from '@/ui/components/journal/EventText'
import { STATUS_CHIP, STATUSES } from '@/ui/components/status/statusStyle'
import { useLongPress } from '@/ui/hooks/useLongPress'
import { useMedia } from '@/ui/hooks/useMedia'

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

  const { state, cache, journal } = media
  const status = state?.status ?? 'absent'
  const poster = posterUrl(cache?.posterPath ?? null, 'w342')
  const backdrop = backdropUrl(cache?.backdropPath ?? null, 'w780')

  return (
    <div className="mx-auto max-w-md px-4 pb-8">
      <div className="relative -mx-4 h-[190px] overflow-hidden sm:mx-0 sm:rounded-card">
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
      </div>

      <div className="relative -mt-14 flex items-end gap-4 px-1.5">
        <Poster src={poster} favorite={state?.favorite ?? false} />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
          <h1 className="font-display text-[21px] font-semibold leading-[1.15] text-text">
            {cache?.title ?? mediaRef}
          </h1>
          <p className="font-mono text-[10.5px] text-muted">{meta(cache, state, t)}</p>
        </div>
      </div>

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

        {cache?.externalRatings.tmdb != null && (
          <span className="ml-auto font-mono text-[10px] text-subtle">
            {t('media.tmdb', { rating: cache.externalRatings.tmdb.toFixed(1) })}
          </span>
        )}
      </div>

      {status === 'seen' && (
        <>
          <button
            type="button"
            onClick={() => void media.watchAgain()}
            className="mt-4 flex h-11 w-full max-w-[420px] items-center justify-center gap-2.5 rounded-action bg-gradient-action shadow-glow-strong"
          >
            <span className="text-base text-bg">↻</span>
            <span className="font-display text-[13px] font-semibold tracking-wide text-bg">
              {t('media.rewatch')}
            </span>
          </button>
          <p className="mt-2 font-mono text-[9.5px] text-subtle">
            {t('media.rewatchHint', { number: (state?.seenCount ?? 0) + 1 })}
          </p>
        </>
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

      <h2 className="mb-2.5 mt-6 font-display text-[13px] font-semibold tracking-wide text-muted">
        {t('media.journal')}
      </h2>

      <Journal entries={journalOf(journal)} onCancel={(id) => void media.cancel(id)} />
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
function Poster({ src, favorite }: { src: string | null; favorite: boolean }) {
  const shape = 'h-36 w-24 flex-none rounded-poster object-cover shadow-poster'

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
