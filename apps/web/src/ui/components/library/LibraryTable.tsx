import { posterUrl } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'

import { episodesFromPercent, hasEpisodes, type MediaStateRow } from '@owlog/domain'
import { ProgressBar } from '@/ui/components/home/ProgressBar'
import { displayStatus, RowPoster, Stars, statusLabel } from '@/ui/components/library/rowParts'
import { STATUS_CHIP } from '@/ui/components/status/statusStyle'
import type { MediaCacheRow } from '@/ports/MediaCache'

export interface LibraryTableProps {
  rows: readonly MediaStateRow[]
  cacheFor: (ref: MediaStateRow['ref']) => MediaCacheRow
  onOpen: (ref: MediaStateRow['ref']) => void
  onCycle: (ref: MediaStateRow['ref']) => void
  onMenu: (row: MediaStateRow) => void
}

/**
 * Bibliotheque desktop — la liste en colonnes du mock 10b.
 *
 * ```
 * TITRE                    TYPE    PROGRESSION      NOTE        STATUT
 * [aff] Dark               serie   [====----] S02E05  —      ● en cours
 * ```
 *
 * Largeurs relevees du mock, pas choisies : TYPE 80px, PROGRESSION 170px,
 * NOTE 90px, STATUT 120px, TITRE prend le reste. En-tetes en mono 9.5px
 * `subtle`, interlettrage .5px.
 *
 * Ce n'est pas un `<table>`. Les colonnes sont un habillage : la ligne reste
 * la meme unite cliquable qu'en mobile, avec sa pastille a deux gestes. Un
 * tableau HTML imposerait sa propre semantique de cellules a une rangee qui
 * est, elle, un bouton.
 *
 * **Le clic droit ouvre le menu de statut**, la ou le mobile fait un appui
 * long : c'est le geste que le mock annonce en pied de liste, et le seul
 * equivalent au pointeur d'un appui prolonge.
 */
export function LibraryTable({ rows, cacheFor, onOpen, onCycle, onMenu }: LibraryTableProps) {
  const { t } = useTranslation()

  return (
    <div className="mt-4 flex flex-col">
      <div className="flex gap-4 px-3.5 pt-5 pb-2 font-mono text-[9.5px] tracking-[.5px] text-subtle">
        <span className="flex-1">{t('library.colTitle')}</span>
        <span className="w-20">{t('library.colType')}</span>
        <span className="w-[170px]">{t('library.colProgress')}</span>
        <span className="w-[90px]">{t('library.colRating')}</span>
        <span className="w-[120px] text-right">{t('library.colStatus')}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <TableRow
            key={row.ref}
            row={row}
            cache={cacheFor(row.ref)}
            onOpen={() => onOpen(row.ref)}
            onCycle={() => onCycle(row.ref)}
            onMenu={() => onMenu(row)}
          />
        ))}
      </div>

      <p className="mt-4 text-center font-mono text-[10px] text-subtle">{t('library.hintDesktop')}</p>
    </div>
  )
}

function TableRow({
  row,
  cache,
  onOpen,
  onCycle,
  onMenu,
}: {
  row: MediaStateRow
  cache: MediaCacheRow
  onOpen: () => void
  onCycle: () => void
  onMenu: () => void
}) {
  const { t } = useTranslation()
  const status = displayStatus(row)

  return (
    <div className="flex items-center gap-4 rounded-[12px] border border-border bg-surface-translucent px-3.5 py-2 transition-colors hover:border-border-active">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <RowPoster
          src={posterUrl(cache.posterPath, 'w185')}
          favorite={row.favorite}
          shape="h-[50px] w-[34px] flex-none rounded-[6px]"
          innerRadius="rounded-[5px]"
          width={34}
          height={50}
        />
        <span className="truncate text-sm font-semibold text-text">{cache.title}</span>
      </button>

      <span className="w-20 font-mono text-[10px] text-muted">
        {t(cache.kind === 'tv' ? 'search.kindSeries' : 'search.kindMovie')}
      </span>

      <span className="flex w-[170px] items-center gap-2">
        <Progress row={row} cache={cache} />
      </span>

      <span className="w-[90px]">
        {row.rating === null ? (
          <span className="font-mono text-[10px] text-subtle">—</span>
        ) : (
          <Stars value={row.rating} className="text-[12px]" />
        )}
      </span>

      <span className="flex w-[120px] items-center justify-end gap-2">
        {row.favorite && (
          <span className="text-[12px] text-gradient-action" aria-label={t('media.favorite')}>
            ♥
          </span>
        )}
        <button
          type="button"
          onClick={onCycle}
          onContextMenu={(event) => {
            event.preventDefault()
            onMenu()
          }}
          aria-label={t('library.cycleLabel', { title: cache.title })}
          className={[
            'min-h-0 min-w-0 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px]',
            STATUS_CHIP[status].on,
          ].join(' ')}
        >
          {statusLabel(row, status, t)}
        </button>
      </span>
    </div>
  )
}

/**
 * Colonne PROGRESSION.
 *
 * Un titre en cours montre sa barre et son rang ; tout autre montre ce qui le
 * situe le mieux — le rang saisi s'il existe (c'est lui qui porte le « arrete
 * a S01E04 » d'un abandon), sinon la duree pour un film, le compte de saisons
 * pour une serie. La colonne ne repete jamais le type ni le statut : ils ont
 * la leur.
 */
function Progress({ row, cache }: { row: MediaStateRow; cache: MediaCacheRow }) {
  const { t } = useTranslation()

  if (displayStatus(row) === 'watching') {
    return (
      <>
        <span className="flex-1">
          <ProgressBar percent={row.percent} />
        </span>
        <span className="font-mono text-[9.5px] whitespace-nowrap text-muted">{rank(row, cache, t)}</span>
      </>
    )
  }

  return <span className="font-mono text-[10px] text-subtle">{extent(row, cache, t)}</span>
}

function rank(
  row: MediaStateRow,
  cache: MediaCacheRow,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (row.label !== null) return row.label
  if (!hasEpisodes(row.ref)) return `${row.percent}%`

  const seen = episodesFromPercent(row.percent, cache.numberOfEpisodes)
  return seen === null ? `${row.percent}%` : t('home.episodeCount', { seen, total: cache.numberOfEpisodes })
}

function extent(
  row: MediaStateRow,
  cache: MediaCacheRow,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (row.label !== null) return row.label

  if (cache.kind === 'tv') {
    const seasons = cache.numberOfSeasons
    return seasons == null ? '—' : `${seasons} ${t('media.seasonsWord', { count: seasons })}`
  }

  const parts: string[] = []
  if (cache.totalRuntime !== null) parts.push(runtime(cache.totalRuntime, t))
  if (cache.year !== null) parts.push(cache.year.toString())

  return parts.length === 0 ? '—' : parts.join(' · ')
}

/** `2h46`. Les minutes sont completees a deux chiffres, sinon `2h6` se lit mal. */
function runtime(minutes: number, t: ReturnType<typeof useTranslation>['t']): string {
  return t('library.runtime', {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, '0'),
  })
}
