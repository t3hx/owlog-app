import { posterUrl } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'

import type { TapProjection } from '@/domain/rules/progression'
import type { MediaCacheRow } from '@/ports/MediaCache'
import { ProgressBar } from '@/ui/components/home/ProgressBar'

export interface WatchingRowProps {
  cache: MediaCacheRow
  /** Avancement **affiché** : celui du store plus les taps pas encore écrits. */
  projection: TapProjection
  /** Le label décrit un point plus ancien que la progression. */
  labelStale: boolean
  onOpen: () => void
  onPlay: () => void
}

/**
 * Rangée d'un titre en cours, sur l'accueil.
 *
 * Affiche 56×84, titre, `S02E05 · 62%`, barre 4px, bouton play 44px — la
 * géométrie du handoff, au pixel.
 *
 * Le play est un bouton **frère** de la zone d'ouverture et non un bouton
 * imbriqué dedans : un bouton dans un bouton est invalide, et la propagation
 * ferait ouvrir la fiche à chaque avancement.
 *
 * Le pourcentage est arrondi **à l'affichage seulement**. La valeur exacte
 * reste dans l'événement : `100 / 8` vaut 12,5, et arrondir à la source
 * ferait atteindre 100 avant le dernier épisode.
 */
export function WatchingRow({
  cache,
  projection,
  labelStale,
  onOpen,
  onPlay,
}: WatchingRowProps) {
  const { t } = useTranslation()
  const poster = posterUrl(cache.posterPath, 'w185')

  return (
    <div className="flex items-center gap-3.5 rounded-card border border-border bg-surface-translucent p-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            width={56}
            height={84}
            loading="lazy"
            // Réponse non opaque, sinon Workbox compte plusieurs mégaoctets
            // par affiche et le quota dépassé évince IndexedDB.
            crossOrigin="anonymous"
            className="h-[84px] w-14 flex-none rounded-poster-sm object-cover"
          />
        ) : (
          <span className="h-[84px] w-14 flex-none rounded-poster-sm bg-poster-placeholder" />
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="w-full truncate text-[15px] font-semibold text-text">
            {cache.title}
          </span>
          <span
            className={[
              'font-mono text-[11px]',
              // Un label périmé se grise plutôt que de disparaître : le
              // retirer ferait croire qu'aucun épisode n'a jamais été noté.
              labelStale ? 'text-subtle' : 'text-muted',
            ].join(' ')}
          >
            {[projection.label, t('home.percent', { percent: Math.round(projection.percent) })]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <ProgressBar percent={projection.percent} />
        </span>
      </button>

      <button
        type="button"
        onClick={onPlay}
        aria-label={t('home.play', { title: cache.title })}
        className="flex size-11 flex-none items-center justify-center rounded-action bg-gradient-action shadow-glow-strong"
      >
        {/* Triangle dessiné en CSS, comme la loupe de la barre de recherche :
            faire entrer une bibliothèque d'icônes dans le bundle pour trois
            traits coûterait plus cher que de les tracer. */}
        <span className="ml-[3px] size-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-bg" />
      </button>
    </div>
  )
}
