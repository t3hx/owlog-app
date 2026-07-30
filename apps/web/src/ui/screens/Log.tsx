import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import type { MediaRef } from '@/domain/types'
import { EventText } from '@/ui/components/journal/EventText'
import { useLog } from '@/ui/hooks/useLog'
import { usePorts } from '@/ui/PortsProvider'

/**
 * LOG global.
 *
 * Flux plat de tout ce qui a été fait, tous médias confondus. Spécification :
 * `docs/design_handoff_owlog/log-global.md`.
 *
 * **Il ne groupe rien.** Ni sections, ni marqueurs `— visionnage #N —` : ces
 * derniers ont du sens sur une fiche, où les cycles d'un titre se suivent,
 * mais noyés dans tous médias confondus ils numéroteraient des choses sans
 * rapport les unes sous les autres.
 *
 * **Lecture seule.** L'annulation vit sur la fiche, où l'on voit le cycle
 * auquel l'entrée appartient. Annuler à l'aveugle dans un flux serait le
 * geste le plus regrettable qu'on puisse offrir sur un journal.
 */
export function Log() {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const { live } = usePorts()
  const { entries, loading, exhausted, loadMore } = useLog()

  const titles = new Map(live.useMediaCacheRows().map((row) => [row.ref, row.title]))

  /** `tmdb:movie/603` devient `/media/movie/603`. */
  const open = (ref: MediaRef) => navigate(`/media/${ref.replace('tmdb:', '')}`)

  return (
    <div className="mx-auto flex max-w-md flex-col px-5 pb-8 pt-8">
      <h1 className="font-display text-[25px] font-semibold text-text">{t('log.title')}</h1>
      <p className="font-mono text-[11px] text-muted">
        {t('log.loaded', { count: entries.length })}
      </p>

      {entries.length === 0 && !loading ? (
        <div className="flex flex-col items-start gap-2 py-8">
          <p className="font-display text-[15px] font-semibold text-text">{t('log.empty')}</p>
          <p className="text-sm text-muted">{t('log.emptyHint')}</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2 border-l border-border pl-3.5">
          {entries.map((entry) => (
            <button
              key={entry.event.id}
              type="button"
              onClick={() => open(entry.event.media_ref)}
              className="min-h-0 min-w-0 text-left font-mono text-[10.5px] text-muted"
            >
              <EventText event={entry.event} />
              {' · '}
              {/* Jamais une référence nue. Après une restauration depuis un
                  `.log`, les événements reviennent sans le cache TMDB :
                  ouvrir la fiche appelle `/media/:ref` et le répare. */}
              <span className="text-text">
                {titles.get(entry.event.media_ref) ?? t('home.uncached')}
              </span>
            </button>
          ))}
        </div>
      )}

      {!exhausted && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className="mt-6 self-center font-mono text-[10px] text-subtle disabled:text-border-active"
        >
          {loading ? t('log.loading') : t('log.more')}
        </button>
      )}
    </div>
  )
}
