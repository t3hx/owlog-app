import { posterUrl } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'

import { episodesFromPercent, hasEpisodes, type TapProjection } from '@owlog/domain'
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
 *
 * La numérotation d'épisode vient du label saisi (`S01E04`) quand il existe.
 * Sans label, elle se **déduit** du pourcentage et du compte d'épisodes du
 * cache (`ép. 3/10`) : pas de saison affirmée — personne ne l'a dite — mais
 * un rang, que le pourcentage seul ne raconte pas.
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

  const deducedEpisodes =
    projection.label === null && hasEpisodes(cache.ref)
      ? episodesFromPercent(projection.percent, cache.numberOfEpisodes)
      : null
  const episodeText =
    projection.label ??
    (deducedEpisodes === null
      ? null
      : t('home.episodeCount', { seen: deducedEpisodes, total: cache.numberOfEpisodes }))

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
            {[episodeText, t('home.percent', { percent: Math.round(projection.percent) })]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <ProgressBar percent={projection.percent} />
        </span>
      </button>

      <button
        type="button"
        onClick={onPlay}
        // Le libellé accessible dit ce que le tap fait vraiment : avancer un
        // média à épisodes, marquer vu un film. Même règle que le handler.
        aria-label={t(hasEpisodes(cache.ref) ? 'home.play' : 'home.markSeen', {
          title: cache.title,
        })}
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
