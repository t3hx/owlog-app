import { parseMediaRef } from '@owlog/contracts'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import { homeCounters, type MediaStateRow } from '@/domain/reducers/mediaState'
import { applyTaps, episodeIncrement } from '@/domain/rules/progression'
import type { MediaRef } from '@/domain/types'
import { ToWatchShelf } from '@/ui/components/home/ToWatchShelf'
import { WatchingRow } from '@/ui/components/home/WatchingRow'
import { Search } from '@/ui/components/search/Search'
import { usePlay } from '@/ui/hooks/usePlay'
import { usePorts } from '@/ui/PortsProvider'
import type { MediaCacheRow } from '@/ports/MediaCache'

/**
 * Accueil.
 *
 * Trois blocs : la salutation et ses compteurs, `▸ EN COURS` avec son bouton
 * play, `▸ À VOIR` en étagère horizontale.
 *
 * Les compteurs ont d'abord été écrits en dur à `0`, et c'était le pire des
 * deux mondes : tant qu'aucun écran ne montrait la bibliothèque, cette ligne
 * était le seul retour visible après un ajout, et elle affirmait qu'il ne
 * s'était rien passé. Un placeholder qui se tait laisse deviner qu'il est
 * vide ; un compteur faux fait diagnostiquer une perte de données qui
 * n'existe pas. C'est la même règle qui fait afficher — et non masquer — un
 * titre dont la fiche de cache manque.
 *
 * Une section vide ne s'affiche pas du tout : un `▸ EN COURS` suivi de rien
 * n'apprend rien que les compteurs n'aient déjà dit.
 */
export function Home({ firstName }: { firstName: string }) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const { live } = usePorts()
  const { tap, pendingTaps } = usePlay()

  const states = live.useMediaStates()
  const cache = live.useMediaCacheRows()
  const counters = homeCounters(states)

  const byRef = new Map(cache.map((row) => [row.ref, row]))
  const cacheFor = (ref: MediaRef): MediaCacheRow =>
    byRef.get(ref) ?? placeholder(ref, t('home.uncached'))

  const watching = states.filter((row) => row.status === 'watching').sort(byRecency)
  const toWatch = states.filter((row) => row.status === 'to-watch').sort(byRecency)

  /** `tmdb:movie/603` devient `/media/movie/603` : deux-points et barre ne
   *  passent pas tels quels dans un chemin. */
  const open = (ref: string) => navigate(`/media/${ref.replace('tmdb:', '')}`)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-1 pt-6">
      <Search context="add">
        <div className="px-5 pt-2">
          <h1 className="font-display text-[25px] font-semibold text-text">
            {t('home.greeting', { firstName })}
          </h1>
          <p className="font-mono text-[11px] text-muted">{t('home.counters', counters)}</p>

          {watching.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 font-display text-[15px] font-semibold tracking-wide text-accent">
                {t('home.watching')}
              </h2>
              <div className="flex flex-col gap-2.5">
                {watching.map((row) => {
                  const media = cacheFor(row.ref)
                  const increment = episodeIncrement(media.numberOfEpisodes)

                  return (
                    <WatchingRow
                      key={row.ref}
                      cache={media}
                      // L'affichage avance au tap, l'écriture est regroupée :
                      // la projection est ce que les deux chemins partagent.
                      projection={applyTaps(
                        { percent: row.percent, label: row.label },
                        pendingTaps(row.ref),
                        increment,
                      )}
                      labelStale={row.labelStale}
                      onOpen={() => open(row.ref)}
                      onPlay={() => tap(row.ref, increment)}
                    />
                  )
                })}
              </div>
            </>
          )}

          {toWatch.length > 0 && (
            <>
              <div className="mb-3 mt-6 flex items-baseline justify-between">
                <h2 className="font-display text-[15px] font-semibold tracking-wide text-text">
                  {t('home.toWatch')}{' '}
                  <span className="font-mono text-[10px] font-normal text-muted">
                    · {toWatch.length}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('/library')}
                  className="min-h-0 min-w-0 font-mono text-[10px] text-subtle"
                >
                  {t('home.seeAll')}
                </button>
              </div>
              <ToWatchShelf rows={toWatch.map((row) => cacheFor(row.ref))} onOpen={open} />
            </>
          )}
        </div>
      </Search>
    </div>
  )
}

/**
 * Le plus récemment touché en tête.
 *
 * `updatedAt` est le dernier `created_at` écrit sur le média, donc l'ordre
 * dans lequel on s'en est occupé — pas l'ordre d'ajout. C'est la série de
 * hier soir qu'on veut sous le pouce, pas celle ajoutée il y a six mois.
 */
function byRecency(a: MediaStateRow, b: MediaStateRow): number {
  return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
}

/**
 * Ligne de cache de secours, quand le cache ne connaît pas le titre.
 *
 * Le cas est réel : une restauration depuis un `.log` rejoue les événements,
 * pas le cache TMDB. Sauter ces titres ferait dire « 3 en cours » à la ligne
 * de compteurs au-dessus d'une section vide — le défaut exact que ce même
 * écran a déjà produit une fois. La rangée reste donc affichée et cliquable :
 * ouvrir la fiche appelle `/media/:ref` et répare le cache.
 */
function placeholder(ref: MediaRef, title: string): MediaCacheRow {
  return {
    ref,
    kind: parseMediaRef(ref)?.kind ?? 'movie',
    title,
    year: null,
    posterPath: null,
    backdropPath: null,
    genres: [],
    totalRuntime: null,
    numberOfEpisodes: null,
    overview: '',
    externalRatings: { tmdb: null },
    fetchedAt: '',
    complete: false,
  }
}
