import { posterUrl, type SearchHit } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'

import type { Status } from '@/domain/types'

/**
 * Rangée d'un média dans les résultats de recherche.
 *
 * Affiche 48×72 au ratio 2:3, comme le handoff. La taille est fixe et non
 * fluide : une grille de posters aux hauteurs variables donne un rythme
 * cassé, et le handoff l'a tranché.
 */
export interface MediaRowProps {
  hit: SearchHit
  /** Statut si le titre est déjà en bibliothèque. */
  status?: Status
  /** Absent quand le titre est déjà là : on n'ajoute pas deux fois. */
  onAdd?: () => void
  /** Présent juste après un ajout, le temps de pouvoir revenir en arrière. */
  onUndo?: () => void
  justAdded?: boolean
}

export function MediaRow({ hit, status, onAdd, onUndo, justAdded }: MediaRowProps) {
  const { t } = useTranslation()
  const poster = posterUrl(hit.posterPath, 'w185')

  return (
    <div
      className={[
        'flex items-center gap-3 rounded-card border bg-surface-translucent p-2.5',
        justAdded ? 'border-border-accent' : 'border-border',
      ].join(' ')}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          width={48}
          height={72}
          loading="lazy"
          // Requis pour que Workbox reçoive une réponse non opaque : une
          // réponse opaque compte plusieurs mégaoctets dans le quota, et
          // dépasser le quota déclenche l'éviction d'IndexedDB.
          crossOrigin="anonymous"
          className="h-[72px] w-12 flex-none rounded-poster object-cover"
        />
      ) : (
        <span className="h-[72px] w-12 flex-none rounded-poster bg-poster-placeholder" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-sm font-semibold text-text">{hit.title}</span>
        <span className="font-mono text-[10px] text-muted">
          {[
            hit.year ?? t('search.unknownYear'),
            t(hit.kind === 'movie' ? 'search.kindMovie' : 'search.kindSeries'),
            status ? t(`status.${status}` as 'status.to-watch') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {justAdded && onUndo ? (
        <div className="flex flex-none flex-col items-end gap-1">
          <span className="font-mono text-[10px] text-accent">{t('search.added')}</span>
          <button
            type="button"
            onClick={onUndo}
            className="min-h-0 min-w-0 font-mono text-[10px] text-subtle underline"
          >
            {t('search.undo')}
          </button>
        </div>
      ) : onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={t('search.addLabel', { title: hit.title })}
          className="size-11 flex-none rounded-action border border-border-accent font-mono text-lg text-accent"
        >
          +
        </button>
      ) : null}
    </div>
  )
}
