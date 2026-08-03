import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import { homeCounters, type MediaStateRow, applyTaps, episodeIncrement, hasEpisodes, type MediaRef } from '@owlog/domain'
import { ToWatchShelf } from '@/ui/components/home/ToWatchShelf'
import { WatchingRow } from '@/ui/components/home/WatchingRow'
import { Search } from '@/ui/components/search/Search'
import { useDesktop } from '@/ui/hooks/useDesktop'
import { usePlay } from '@/ui/hooks/usePlay'
import { usePorts } from '@/ui/PortsProvider'
import { placeholderCacheRow, type MediaCacheRow } from '@/ports/MediaCache'

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
  const { tap, pendingTaps, markSeen, startWatching } = usePlay()
  const desktop = useDesktop()

  const states = live.useMediaStates()
  const cache = live.useMediaCacheRows()
  const counters = homeCounters(states)

  const byRef = new Map(cache.map((row) => [row.ref, row]))
  const cacheFor = (ref: MediaRef): MediaCacheRow =>
    byRef.get(ref) ?? placeholderCacheRow(ref, t('home.uncached'))

  const watching = states.filter((row) => row.status === 'watching').sort(byRecency)
  const toWatch = states.filter((row) => row.status === 'to-watch').sort(byRecency)

  /** `tmdb:movie/603` devient `/media/movie/603` : deux-points et barre ne
   *  passent pas tels quels dans un chemin. */
  const open = (ref: string) => navigate(`/media/${ref.replace('tmdb:', '')}`)

  return (
    <div className={desktop ? 'flex flex-col gap-1' : 'mx-auto flex max-w-md flex-col gap-1 pt-6'}>
      <Search
        context="add"
        aside={
          <span className="pb-3 font-mono text-[11px] text-muted">
            {today(t)} · {t('home.counters', counters)}
          </span>
        }
      >
        <div className={desktop ? undefined : 'px-5 pt-2'}>
          <h1
            className={
              desktop
                ? 'mt-[30px] font-display text-[28px] font-semibold text-text'
                : 'font-display text-[25px] font-semibold text-text'
            }
          >
            {t('home.greeting', { firstName })}
          </h1>
          {/* Les compteurs vivent a droite de la barre en desktop (mock 10a) :
              les repeter sous la salutation les dirait deux fois. */}
          {!desktop && (
            <p className="font-mono text-[11px] text-muted">{t('home.counters', counters)}</p>
          )}

          {watching.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 font-display text-[15px] font-semibold tracking-wide text-accent">
                {t('home.watching')}
              </h2>
              <div className={desktop ? 'grid grid-cols-2 gap-4' : 'flex flex-col gap-2.5'}>
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
                      // Play adaptatif : un média à épisodes avance d'un
                      // épisode, un film se marque vu — une progression n'y
                      // aurait pas de sens.
                      onPlay={() =>
                        hasEpisodes(row.ref) ? tap(row.ref, increment) : void markSeen(row.ref)
                      }
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
              <ToWatchShelf
                desktop={desktop}
                rows={toWatch.map((row) => cacheFor(row.ref))}
                onOpen={open}
                // Le play discret de l'affiche : le titre passe « en cours »
                // sans ouvrir la fiche. Le geste vit ici seulement, jamais en
                // Bibliothèque (décision D2.3).
                onStart={(ref) => void startWatching(ref as MediaRef)}
              />
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
 * La date du jour, en tete de contenu desktop (mock 10a : « dim 27 juil »).
 *
 * Formatee par `Intl` dans la langue courante, pas par un gabarit maison :
 * l'ordre des elements et les abreviations different d'une langue a l'autre,
 * et c'est exactement ce que `Intl` sait et qu'une concatenation ignore.
 */
function today(t: ReturnType<typeof useTranslation>['t']): string {
  return new Date().toLocaleDateString(t('app.locale'), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

