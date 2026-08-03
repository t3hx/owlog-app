import type { SearchHit } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import type { Status } from '@owlog/domain'
import type { CatalogFailure } from '@/ports/MediaCatalog'
import { MediaRow } from '@/ui/components/search/MediaRow'
import { usePorts } from '@/ui/PortsProvider'
import { useAddMedia } from '@/ui/hooks/useAddMedia'
import type { SearchMode } from '@/ui/components/search/Search'
import type { SearchScope, SearchState } from '@/ui/hooks/useSearch'

/**
 * Résultats de recherche.
 *
 * Deux groupes, comme le handoff : **ce qui est déjà en bibliothèque**
 * d'abord, avec son statut, puis les résultats de l'API. L'ordre n'est pas
 * cosmétique — c'est ce qui évite d'ajouter deux fois un titre qu'on a
 * oublié avoir logué.
 *
 * Le groupe « déjà en bibliothèque » n'offre pas le `+`, mais **offre le
 * `✓`** : un titre déjà là est précisément celui dont on veut enregistrer un
 * visionnage passé. Refuser le geste obligerait à passer par la fiche, soit
 * trois écrans par titre là où la session en demande un.
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
  /** Relance la requête en échec, sans passer par une modification du texte. */
  onRetry: () => void
  /** Appelé après un ajout abouti, pour retirer l'entrée de file résolue. */
  onAdded?: () => void
  /** `log` remplace le `+` par la saisie d'un souvenir. */
  mode?: SearchMode
  onLog?: (hit: SearchHit) => void
}

export function SearchResults({
  state,
  scope,
  query,
  onSetAside,
  onRetry,
  onAdded,
  mode = 'add',
  onLog,
}: SearchResultsProps) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const { live } = usePorts()

  /** `tmdb:movie/603` devient `/media/movie/603` : deux-points et barre ne
   *  passent pas tels quels dans un chemin. */
  const open = (ref: string) => () => navigate(`/media/${ref.replace('tmdb:', '')}`)
  const states = live.useMediaStates()
  const { add, addFavorite, addStarted, undoLast, forget, lastAdded } = useAddMedia()

  /**
   * Un geste d'ajout, quel que soit le bouton : oublier l'annulation
   * précédente, écrire, puis signaler l'ajout pour résoudre l'entrée de la
   * file hors-ligne. Trois boutons, une seule séquence — la faire diverger
   * ferait des gestes rapides des ajouts qui ne vident pas la file.
   */
  const perform = (write: (hit: SearchHit) => Promise<void>) => (hit: SearchHit) => {
    forget()
    void write(hit).then(() => onAdded?.())
  }

  if (state.status === 'idle') return null

  if (state.status === 'searching') {
    return <p className="px-3 py-4 font-mono text-[10px] text-subtle">…</p>
  }

  if (state.status === 'failed') {
    return (
      <Failure
        failure={state.failure}
        query={query}
        onSetAside={onSetAside}
        onRetry={onRetry}
      />
    )
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
              <MediaRow
                key={hit.ref}
                hit={hit}
                onOpen={open(hit.ref)}
                {...statusProp(known.get(hit.ref))}
                {...(mode === 'log' && onLog ? { onLog: () => onLog(hit) } : {})}
              />
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
                onOpen={open(hit.ref)}
                justAdded={lastAdded?.ref === hit.ref}
                {...(mode === 'log' && onLog
                  ? { onLog: () => onLog(hit) }
                  : {
                      onAdd: () => perform(add)(hit),
                      onAddFavorite: () => perform(addFavorite)(hit),
                      onAddStarted: () => perform(addStarted)(hit),
                    })}
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
  onRetry,
}: {
  failure: CatalogFailure
  query: string
  onSetAside: (text: string) => void
  onRetry: () => void
}) {
  const { t } = useTranslation()

  if (failure.kind === 'offline') {
    return (
      <Empty
        title={t('search.offline')}
        hint={t('search.offlineHint')}
        query={query}
        onSetAside={onSetAside}
        onRetry={onRetry}
      />
    )
  }

  if (failure.kind === 'rateLimited') {
    return (
      <Empty
        title={t('search.rateLimited')}
        hint={t('search.rateLimitedHint', { count: failure.retryAfter })}
        onRetry={onRetry}
      />
    )
  }

  return (
    <Empty
      title={t('search.unavailable')}
      hint={t('search.unavailableHint')}
      onRetry={onRetry}
    />
  )
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
  onRetry,
}: {
  title: string
  hint: string
  query?: string
  onSetAside?: (text: string) => void
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const trimmed = query?.trim() ?? ''

  return (
    <div className="flex flex-col items-start gap-2 px-3 py-6">
      <p className="font-display text-[15px] font-semibold text-text">{title}</p>
      <p className="text-sm text-muted">{hint}</p>

      {/* Un écran d'échec sans action est une impasse. Le retour du réseau
          relance déjà la requête tout seul ; ce bouton couvre le cas où le
          navigateur ne signale pas la bascule, ce qui arrive sur mobile. */}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 h-11 rounded-action border border-border-active px-4 font-mono text-[11px] text-text"
        >
          {t('search.retry')}
        </button>
      )}

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
