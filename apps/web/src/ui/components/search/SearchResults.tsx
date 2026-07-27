import { useTranslation } from 'react-i18next'

import type { Status } from '@/domain/types'
import type { CatalogFailure } from '@/ports/MediaCatalog'
import { MediaRow } from '@/ui/components/search/MediaRow'
import { usePorts } from '@/ui/PortsProvider'
import { useAddMedia } from '@/ui/hooks/useAddMedia'
import type { SearchScope, SearchState } from '@/ui/hooks/useSearch'

/**
 * Résultats de recherche.
 *
 * Deux groupes, comme le handoff : **ce qui est déjà en bibliothèque**
 * d'abord, avec son statut, puis les résultats de l'API. L'ordre n'est pas
 * cosmétique — c'est ce qui évite d'ajouter deux fois un titre qu'on a
 * oublié avoir logué.
 *
 * Le compteur affiche le nombre d'éléments **après filtrage**, sur cette
 * page seulement. TMDB compte les `person` dans son total, et la pagination
 * n'existe pas au temps 1 : l'écran le dit plutôt que de le taire.
 */
export interface SearchResultsProps {
  state: SearchState
  scope: SearchScope
  /** Texte tapé, pour la mise de côté hors-ligne. */
  query: string
  onSetAside: (text: string) => void
  /** Appelé après un ajout abouti, pour retirer l'entrée de file résolue. */
  onAdded?: () => void
}

export function SearchResults({
  state,
  scope,
  query,
  onSetAside,
  onAdded,
}: SearchResultsProps) {
  const { t } = useTranslation()
  const { live } = usePorts()
  const states = live.useMediaStates()
  const { add, undoLast, forget, lastAdded } = useAddMedia()

  if (state.status === 'idle') return null

  if (state.status === 'searching') {
    return <p className="px-3 py-4 font-mono text-[10px] text-subtle">…</p>
  }

  if (state.status === 'failed') {
    return <Failure failure={state.failure} query={query} onSetAside={onSetAside} />
  }

  const known = new Map<string, Status>(
    states
      .filter((row) => row.status !== 'absent')
      // Le titre qu'on vient d'ajouter reste dans les résultats le temps
      // d'offrir l'annulation. Le faire basculer immédiatement dans le
      // groupe « déjà en bibliothèque » rendrait le lien « annuler »
      // inatteignable : la ligne changerait de place avant qu'on le voie.
      .filter((row) => row.ref !== lastAdded?.ref)
      .map((row) => [row.ref, row.status as Status]),
  )

  const inLibrary = state.hits.filter((hit) => known.has(hit.ref))
  const fresh = state.hits.filter((hit) => !known.has(hit.ref))

  const scopeLabel = t(`search.scope.${scope === 'movie' ? 'movies' : scope === 'tv' ? 'series' : 'all'}` as 'search.scope.all')

  if (state.hits.length === 0) {
    return (
      <Empty
        title={t('search.empty')}
        hint={t('search.emptyHint')}
        query={query}
        onSetAside={onSetAside}
      />
    )
  }

  return (
    <div className="px-3">
      <p className="my-2 font-mono text-[10px] text-subtle">
        {t('search.count', { count: state.hits.length, scope: scopeLabel })}
        {' · '}
        {t('search.noPaging')}
      </p>

      {inLibrary.length > 0 && (
        <>
          <h2 className="mb-2 font-display text-[13px] font-semibold tracking-wide text-muted">
            {t('search.inLibrary')}
          </h2>
          <div className="mb-4 flex flex-col gap-2">
            {inLibrary.map((hit) => (
              <MediaRow key={hit.ref} hit={hit} {...statusProp(known.get(hit.ref))} />
            ))}
          </div>
        </>
      )}

      {fresh.length > 0 && (
        <>
          <h2 className="mb-2 font-display text-[13px] font-semibold tracking-wide text-muted">
            {t('search.results')}
          </h2>
          <div className="flex flex-col gap-2">
            {fresh.map((hit) => (
              <MediaRow
                key={hit.ref}
                hit={hit}
                justAdded={lastAdded?.ref === hit.ref}
                onAdd={() => {
                  forget()
                  void add(hit).then(() => onAdded?.())
                }}
                onUndo={() => void undoLast()}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * `exactOptionalPropertyTypes` distingue « absent » de « présent et
 * indéfini ». Passer `status={undefined}` n'est donc pas la même chose que
 * ne pas passer `status`, et c'est bien la seconde qu'on veut.
 */
function statusProp(status: Status | undefined) {
  return status === undefined ? {} : { status }
}

/**
 * États d'échec.
 *
 * Trois messages distincts et non un seul « une erreur est survenue » :
 * hors-ligne, service muet et quota dépassé appellent trois réactions
 * différentes de la part de l'utilisateur, et la première lui propose une
 * action plutôt qu'une impasse.
 */
function Failure({
  failure,
  query,
  onSetAside,
}: {
  failure: CatalogFailure
  query: string
  onSetAside: (text: string) => void
  /** Appelé après un ajout abouti, pour retirer l'entrée de file résolue. */
  onAdded?: () => void
}) {
  const { t } = useTranslation()

  if (failure.kind === 'offline') {
    return (
      <Empty
        title={t('search.offline')}
        hint={t('search.offlineHint')}
        query={query}
        onSetAside={onSetAside}
      />
    )
  }

  if (failure.kind === 'rateLimited') {
    return (
      <Empty
        title={t('search.rateLimited')}
        hint={t('search.rateLimitedHint', { count: failure.retryAfter })}
      />
    )
  }

  return <Empty title={t('search.unavailable')} hint={t('search.unavailableHint')} />
}

/**
 * Écran vide, avec une action quand il y en a une.
 *
 * Un état vide qui ne propose rien est une impasse. Quand le réseau manque,
 * mettre le texte de côté est exactement ce que l'utilisateur voulait faire.
 */
function Empty({
  title,
  hint,
  query,
  onSetAside,
}: {
  title: string
  hint: string
  query?: string
  onSetAside?: (text: string) => void
}) {
  const { t } = useTranslation()
  const trimmed = query?.trim() ?? ''

  return (
    <div className="flex flex-col items-start gap-2 px-3 py-6">
      <p className="font-display text-[15px] font-semibold text-text">{title}</p>
      <p className="text-sm text-muted">{hint}</p>

      {onSetAside && trimmed.length > 0 && (
        <button
          type="button"
          onClick={() => onSetAside(trimmed)}
          className="mt-2 h-11 rounded-action border border-border-accent px-4 font-mono text-[11px] text-accent"
        >
          {t('search.setAside', { text: trimmed })}
        </button>
      )}
    </div>
  )
}
