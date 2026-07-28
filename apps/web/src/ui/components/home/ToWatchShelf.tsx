import { posterUrl } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'

import type { MediaCacheRow } from '@/ports/MediaCache'

export interface ToWatchShelfProps {
  rows: readonly MediaCacheRow[]
  onOpen: (ref: string) => void
}

/**
 * Étagère `▸ À VOIR` : rangée horizontale d'affiches 104×156.
 *
 * Horizontale et non empilée : la pile ferait défiler l'accueil sur toute la
 * longueur de la liste des envies, et c'est la section `▸ EN COURS` qui doit
 * rester à portée de pouce.
 *
 * Le débordement porte une bordure de sécurité en bas (`pb-1.5`) pour que le
 * halo des affiches ne soit pas rogné par la zone de défilement.
 */
export function ToWatchShelf({ rows, onOpen }: ToWatchShelfProps) {
  const { t } = useTranslation()

  return (
    <div className="flex gap-3 overflow-x-auto pb-1.5">
      {rows.map((row) => {
        const poster = posterUrl(row.posterPath, 'w342')

        return (
          <button
            key={row.ref}
            type="button"
            onClick={() => onOpen(row.ref)}
            className="flex w-[104px] flex-none flex-col gap-[7px] text-left"
          >
            {poster ? (
              <img
                src={poster}
                alt=""
                width={104}
                height={156}
                loading="lazy"
                crossOrigin="anonymous"
                className="h-[156px] w-[104px] rounded-poster object-cover"
              />
            ) : (
              <span className="h-[156px] w-[104px] rounded-poster bg-poster-placeholder" />
            )}
            <span className="line-clamp-2 text-xs font-medium leading-tight text-text">
              {row.title}
            </span>
            <span className="font-mono text-[9.5px] text-muted">
              {[
                row.year ?? t('search.unknownYear'),
                t(row.kind === 'movie' ? 'search.kindMovie' : 'search.kindSeries'),
              ].join(' · ')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
