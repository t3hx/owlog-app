import { posterUrl } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'

import { episodesFromPercent, hasEpisodes, type MediaStateRow, type Status } from '@owlog/domain'
import { ProgressBar } from '@/ui/components/home/ProgressBar'
import { STATUS_CHIP, STATUS_GLYPH } from '@/ui/components/status/statusStyle'
import type { MediaCacheRow } from '@/ports/MediaCache'
import { useLongPress } from '@/ui/hooks/useLongPress'

export interface LibraryRowProps {
  row: MediaStateRow
  cache: MediaCacheRow
  onOpen: () => void
  /** Tap sur la pastille : statut suivant dans la boucle. */
  onCycle: () => void
  /** Appui long sur la pastille : menu de choix direct. */
  onMenu: () => void
}

/**
 * Rangée de la bibliothèque.
 *
 * Affiche 48×72, titre, méta mono, étoiles si noté, barre de progression si
 * en cours, ♥ en dégradé à gauche de la pastille — la composition du handoff.
 *
 * **La pastille est un bouton à deux gestes** : un tap fait tourner la boucle
 * `à voir → en cours → vu → abandonné → à voir`, un appui long ouvre le menu
 * de choix direct. C'est ce qui permet `à voir → abandonné` en une action au
 * lieu de trois taps qui écriraient chacun un événement définitif dans le
 * journal.
 */
export function LibraryRow({ row, cache, onOpen, onCycle, onMenu }: LibraryRowProps) {
  const { t } = useTranslation()
  const poster = posterUrl(cache.posterPath, 'w185')
  const status = row.status === 'absent' ? 'to-watch' : row.status
  const pillGestures = useLongPress(onMenu, onCycle)

  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-surface-translucent p-2.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <RowPoster src={poster} favorite={row.favorite} />

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="w-full truncate text-sm font-semibold text-text">{cache.title}</span>

          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted">{meta(row, cache, t)}</span>
            {row.rating !== null && <Stars value={row.rating} />}
          </span>

          {/* La barre n'apparaît que sur un titre en cours : la montrer à 0 %
              sur un « à voir » ferait croire à une progression jamais faite. */}
          {status === 'watching' && (
            <span className="block w-[90%]">
              <ProgressBar percent={row.percent} />
            </span>
          )}
        </span>
      </button>

      {row.favorite && (
        <span className="flex-none text-[13px] text-gradient-action" aria-label={t('media.favorite')}>
          ♥
        </span>
      )}

      <button
        type="button"
        {...pillGestures}
        aria-label={t('library.cycleLabel', { title: cache.title })}
        className={[
          'min-h-0 min-w-0 flex-none whitespace-nowrap rounded-full border px-2.5 py-1.5 font-mono text-[10px]',
          STATUS_CHIP[status].on,
        ].join(' ')}
      >
        {pill(row, status, t)}
      </button>
    </div>
  )
}

/** `✓ vu ×3` plutôt que `✓ vu` : le compteur de visionnages est la thèse. */
function pill(
  row: MediaStateRow,
  status: Status,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (status === 'seen' && row.seenCount > 0) {
    return t('media.seenCount', { count: row.seenCount })
  }

  return `${STATUS_GLYPH[status]} ${t(`status.${status}` as 'status.to-watch')}`
}

function meta(
  row: MediaStateRow,
  cache: MediaCacheRow,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const parts = [
    cache.year?.toString() ?? t('search.unknownYear'),
    t(cache.kind === 'tv' ? 'search.kindSeries' : 'search.kindMovie'),
  ]

  if (row.status === 'watching') {
    if (row.label !== null) {
      parts.push(row.label)
    } else if (hasEpisodes(row.ref)) {
      // Sans label saisi, le rang se déduit du pourcentage et du compte
      // d'épisodes — même règle que la rangée « en cours » de l'accueil.
      const seen = episodesFromPercent(row.percent, cache.numberOfEpisodes)
      if (seen !== null) {
        parts.push(t('home.episodeCount', { seen, total: cache.numberOfEpisodes }))
      }
    }
  }

  return parts.join(' · ')
}

/**
 * Affiche de la rangée.
 *
 * Coup de cœur : liseré dégradé 1px + glow **sur l'affiche**, jamais sur la
 * card — la règle ♥ du handoff, identique à celle de la fiche média.
 */
function RowPoster({ src, favorite }: { src: string | null; favorite: boolean }) {
  const shape = 'h-[72px] w-12 flex-none rounded-poster-sm'

  if (!favorite) {
    return src ? (
      <img
        src={src}
        alt=""
        width={48}
        height={72}
        loading="lazy"
        crossOrigin="anonymous"
        className={`${shape} object-cover`}
      />
    ) : (
      <span className={`${shape} bg-poster-placeholder`} />
    )
  }

  return (
    <span className={`${shape} border-gradient shadow-glow`}>
      {src ? (
        <img
          src={src}
          alt=""
          width={48}
          height={72}
          loading="lazy"
          crossOrigin="anonymous"
          className="size-full rounded-[5px] object-cover"
        />
      ) : (
        <span className="block size-full rounded-[5px] bg-poster-placeholder" />
      )}
    </span>
  )
}

/**
 * Étoiles en lecture seule.
 *
 * Pleines en menthe, vides en `border-active` : c'est le rendu du handoff,
 * et le tapable reste sur la fiche. Une note qui se change depuis la liste
 * serait un geste à un tap d'erreur d'un statut.
 */
function Stars({ value }: { value: number }) {
  return (
    <span className="text-[11px] tracking-[1.5px] text-accent">
      {'★'.repeat(value)}
      <span className="text-border-active">{'★'.repeat(5 - value)}</span>
    </span>
  )
}
