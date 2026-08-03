import { posterUrl } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'

import type { MediaCacheRow } from '@/ports/MediaCache'

export interface ToWatchShelfProps {
  rows: readonly MediaCacheRow[]
  onOpen: (ref: string) => void
  /** Fait passer le titre « en cours » : le play discret de l'affiche. */
  onStart: (ref: string) => void
}

/**
 * Étagère `▸ À VOIR` : rangée horizontale d'affiches 104×156.
 *
 * Horizontale et non empilée : la pile ferait défiler l'accueil sur toute la
 * longueur de la liste des envies, et c'est la section `▸ EN COURS` qui doit
 * rester à portée de pouce.
 *
 * Chaque affiche porte un ▶ discret en coin bas-droit : un tap fait passer le
 * titre « en cours », sans ouvrir la fiche. Le play est un bouton **frère**
 * de la zone d'ouverture, posé en absolu par-dessus — un bouton dans un
 * bouton est invalide, et la propagation ferait ouvrir la fiche à chaque
 * démarrage. Ce geste vit sur l'accueil seulement, jamais en Bibliothèque
 * (décision D2.3).
 *
 * Le débordement porte une bordure de sécurité en bas (`pb-1.5`) pour que le
 * halo des affiches ne soit pas rogné par la zone de défilement.
 */
export function ToWatchShelf({ rows, onOpen, onStart }: ToWatchShelfProps) {
  const { t } = useTranslation()

  return (
    <div className="flex gap-3 overflow-x-auto pb-1.5">
      {rows.map((row) => {
        const poster = posterUrl(row.posterPath, 'w342')

        return (
          <div key={row.ref} className="relative w-[104px] flex-none">
            <button
              type="button"
              onClick={() => onOpen(row.ref)}
              className="flex w-full flex-col gap-[7px] text-left"
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

            {/* Coin bas-droit de l'affiche : 156px de haut, moins la cible de
                44px, place le bouton à 112px du haut. */}
            <button
              type="button"
              onClick={() => onStart(row.ref)}
              aria-label={t('home.startWatching', { title: row.title })}
              className="absolute right-0 top-[112px] flex size-11 items-center justify-center text-[15px] text-text/80"
            >
              ▶
            </button>
          </div>
        )
      })}
    </div>
  )
}
