import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StatsPeriod, StatsRatings, StatsView } from '@/domain/reducers/stats'
import { useStats } from '@/ui/hooks/useStats'

const PERIODS: readonly StatsPeriod[] = ['month', 'year', 'all']

/**
 * Stats.
 *
 * Card héros du temps total, répartition, tuiles, donut des notes, genres
 * favoris. Recréation du prototype `Owlog Prototype.dc.html`.
 *
 * **Les exclusions s'affichent, elles ne se masquent pas.** C'est le critère
 * d'acceptation de l'étape, et ce n'est pas une précaution théorique : TMDB
 * rend `episode_run_time` vide très souvent, y compris sur des séries
 * majeures, donc un total muet sur ces titres serait crédible et faux. Deux
 * mentions chiffrées le disent — l'une sous le temps total, l'autre sous les
 * genres.
 *
 * Toutes les valeurs viennent de `domain/reducers/stats`. Cet écran ne
 * calcule qu'une chose : la conversion des minutes en heures.
 */
export function Stats() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<StatsPeriod>('year')
  const { view, loading } = useStats(period)

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 pb-8 pt-8">
      <h1 className="font-display text-[25px] font-semibold text-text">{t('stats.title')}</h1>

      <div className="mt-3.5 flex gap-2">
        {PERIODS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPeriod(option)}
            aria-pressed={period === option}
            className={[
              'min-h-0 min-w-0 flex-none rounded-full border px-3.5 py-[7px] font-mono text-[10.5px]',
              period === option
                ? 'border-border-accent bg-accent/8 text-accent'
                : 'border-border text-muted',
            ].join(' ')}
          >
            {t(`stats.period.${option}` as 'stats.period.all')}
          </button>
        ))}
      </div>

      {loading || view === null ? (
        <p className="py-8 font-mono text-[10px] text-subtle">{t('stats.loading')}</p>
      ) : view.counts.seen + view.counts.watching === 0 && view.totalMinutes === 0 ? (
        <div className="flex flex-col items-start gap-2 py-8">
          <p className="font-display text-[15px] font-semibold text-text">{t('stats.empty')}</p>
          <p className="text-sm text-muted">{t('stats.emptyHint')}</p>
        </div>
      ) : (
        <Body view={view} period={period} />
      )}
    </div>
  )
}

function Body({ view, period }: { view: StatsView; period: StatsPeriod }) {
  const { t } = useTranslation()
  const periodLabel = t(`stats.period.${period}` as 'stats.period.all')

  const total = hours(view.totalMinutes)
  const delta = view.previousMinutes === null ? null : total - hours(view.previousMinutes)

  return (
    <>
      <section className="mt-4 rounded-card border border-border bg-surface-translucent p-5">
        <p className="font-mono text-[10px] tracking-wide text-subtle">
          {t('stats.totalLabel', { period: periodLabel.toUpperCase() })}
        </p>

        <div className="mt-1.5 flex items-baseline gap-2.5">
          <span className="font-display text-[44px] font-bold leading-none text-gradient-action">
            {t('stats.hours', { hours: total })}
          </span>
          {delta !== null && delta !== 0 && (
            <span
              className={`font-mono text-[11px] ${delta > 0 ? 'text-accent' : 'text-status-dropped'}`}
            >
              {t(delta > 0 ? 'stats.deltaUp' : 'stats.deltaDown', { hours: Math.abs(delta) })}
            </span>
          )}
        </div>

        <div className="mt-3.5 flex gap-4">
          <span className="font-mono text-[10.5px] text-muted">
            <span className="text-status-seen">■</span>{' '}
            {t('stats.legendMovies', { hours: hours(view.movieMinutes) })}
          </span>
          <span className="font-mono text-[10.5px] text-muted">
            <span className="text-accent">■</span>{' '}
            {t('stats.legendSeries', { hours: hours(view.seriesMinutes) })}
          </span>
        </div>

        {/* Les deux mentions chiffrées qui rendent le total honnête. Sans
            elles, `0h` sur une période où l'on a regardé passerait pour un
            bug de calcul plutôt que pour une donnée manquante. */}
        {view.seriesWithoutRuntime > 0 && (
          <p className="mt-2.5 font-mono text-[9.5px] text-subtle">
            {t('stats.excludedRuntime', { count: view.seriesWithoutRuntime })}
          </p>
        )}
        {view.progressExcludedByPeriod > 0 && (
          <p className="mt-1.5 font-mono text-[9.5px] text-subtle">
            {t('stats.excludedProgress', { count: view.progressExcludedByPeriod })}
          </p>
        )}
      </section>

      <SectionTitle>{t('stats.split')}</SectionTitle>
      <Split view={view} />

      <div className="mt-5 flex gap-2.5">
        <Tile value={view.counts.seen} label={t('stats.tileSeen')} tone="text-status-seen" />
        <Tile value={view.counts.watching} label={t('stats.tileWatching')} tone="text-accent" />
        <Tile
          value={view.counts.favorites}
          label={t('stats.tileFavorites')}
          tone="text-gradient-action"
        />
      </div>

      <SectionTitle>{t('stats.ratingsTitle')}</SectionTitle>
      <section className="flex items-center gap-[18px] rounded-card border border-border bg-surface-translucent p-3.5">
        <Donut ratings={view.ratings} />

        <div className="flex flex-1 flex-col gap-1.5">
          <Legend tone="text-accent" label={t('stats.good', { percent: share(view.ratings, 'good') })} />
          <Legend tone="text-status-watch" label={t('stats.mid', { percent: share(view.ratings, 'mid') })} />
          <Legend tone="text-status-dropped" label={t('stats.bad', { percent: share(view.ratings, 'bad') })} />
        </div>
      </section>

      <p className="mt-2.5 font-mono text-[10px] text-subtle">
        {t('stats.summary', {
          completion: view.completion ?? 0,
          rewatches: view.rewatches,
          episodes: view.episodesSeen,
        })}
      </p>

      <SectionTitle>{t('stats.genresTitle')}</SectionTitle>
      {view.genres.length === 0 ? (
        <p className="font-mono text-[10px] text-subtle">{t('stats.noGenres')}</p>
      ) : (
        <div className="flex max-w-[620px] flex-col gap-2.5">
          {view.genres.map((genre) => (
            <div key={genre.name} className="flex items-center gap-2.5">
              <span className="w-[110px] flex-none truncate font-mono text-[10.5px] text-text">
                {genre.name}
              </span>
              <span className="h-1 flex-1 rounded-[2px] bg-border">
                <span
                  className="block h-full rounded-[2px] bg-gradient-progress"
                  style={{ width: `${genre.percent}%` }}
                />
              </span>
              <span className="w-9 flex-none text-right font-mono text-[10px] text-muted">
                {genre.percent}%
              </span>
            </div>
          ))}
        </div>
      )}

      {view.mediaWithoutGenres > 0 && (
        <p className="mt-2.5 font-mono text-[9.5px] text-subtle">
          {t('stats.excludedGenres', { count: view.mediaWithoutGenres })}
        </p>
      )}
    </>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-[22px] font-display text-[13px] font-semibold tracking-wide text-muted">
      {children}
    </h2>
  )
}

/**
 * Barre empilée séries / films.
 *
 * Les deux parts sont calculées sur les minutes et non sur le nombre de
 * titres : c'est une répartition du **temps**, et douze films courts ne
 * pèsent pas une saison.
 */
function Split({ view }: { view: StatsView }) {
  const { t } = useTranslation()
  const total = view.movieMinutes + view.seriesMinutes
  const series = total === 0 ? 0 : Math.round((view.seriesMinutes / total) * 100)
  const movies = total === 0 ? 0 : 100 - series

  return (
    <>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
        <span className="block bg-accent" style={{ width: `${series}%` }} />
        <span className="block bg-blue" style={{ width: `${movies}%` }} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
        <span>{t('stats.splitSeries', { percent: series, count: view.seriesCount })}</span>
        <span>{t('stats.splitMovies', { percent: movies, count: view.movieCount })}</span>
      </div>
    </>
  )
}

function Tile({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-card border border-border bg-surface-translucent p-3.5">
      <span className={`font-display text-[22px] font-bold ${tone}`}>{value}</span>
      <span className="font-mono text-[9.5px] text-muted">{label}</span>
    </div>
  )
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="font-mono text-[10.5px] text-muted">
      <span className={tone}>■</span> {label}
    </span>
  )
}

/**
 * Donut des notes, en `conic-gradient`.
 *
 * Trois secteurs et un disque au centre : la technique du handoff, sans SVG
 * ni bibliothèque. Sans aucune note, l'anneau reste gris plutôt que de
 * montrer un secteur vert à 100 % — un donut plein sur zéro note affirmerait
 * que tout est bien noté.
 */
function Donut({ ratings }: { ratings: StatsRatings }) {
  const { t } = useTranslation()

  const good = share(ratings, 'good')
  const mid = share(ratings, 'mid')
  const ring =
    ratings.rated === 0
      ? 'var(--color-border)'
      : `conic-gradient(var(--color-accent) 0 ${good}%, var(--color-status-watch) ${good}% ${good + mid}%, var(--color-status-dropped) ${good + mid}% 100%)`

  return (
    <div
      className="flex size-[84px] flex-none items-center justify-center rounded-full"
      style={{ background: ring }}
    >
      <div className="flex size-[58px] flex-col items-center justify-center gap-px rounded-full bg-surface">
        <span className="font-display text-[15px] font-bold text-accent">
          {ratings.average === null ? '★—' : `★${ratings.average}`}
        </span>
        <span className="font-mono text-[8px] text-subtle">{t('stats.average')}</span>
      </div>
    </div>
  )
}

/** Part d'un groupe de notes, en pourcentage entier. */
function share(ratings: StatsRatings, group: 'good' | 'mid' | 'bad'): number {
  if (ratings.rated === 0) return 0
  return Math.round((ratings[group] / ratings.rated) * 100)
}

/**
 * Minutes en heures.
 *
 * Le seul calcul de cet écran, et il est de présentation : le domaine rend
 * des minutes parce que c'est l'unité de TMDB, et arrondir plus tôt ferait
 * perdre les courts métrages dans les sommes.
 */
function hours(minutes: number): number {
  return Math.round(minutes / 60)
}
