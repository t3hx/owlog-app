import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { metrics, type Metrics } from '@/domain/reducers/metrics'
import type { StoredEvent, MediaRef } from '@/domain/types'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Écran de diagnostic.
 *
 * Volontairement non stylé : il n'est pas dans le handoff, il ne sera
 * jamais montré à personne, et lui donner l'apparence du reste de l'app
 * ferait croire qu'il en fait partie.
 *
 * Il répond à trois questions qu'aucun autre écran ne pose :
 *
 * 1. **Le moment fort a-t-il jamais été déclenché ?** Si les visionnages
 *    au-delà du premier restent à zéro après deux semaines, le produit
 *    livré n'est qu'une watchlist de plus.
 * 2. **Une version du client a-t-elle déposé des données qu'une autre ne
 *    lit pas ?** Les réducteurs ignorent silencieusement les types
 *    inconnus ; sans ce compteur, « ignorer » voudrait dire « perdre ».
 * 3. **La table dérivée est-elle réparable ?** Le bouton de reconstruction
 *    est le chemin de réparation, pas un utilitaire de confort.
 */
export function Debug() {
  const { t } = useTranslation()
  const { events } = usePorts()
  const [measures, setMesures] = useState<Metrics | null>(null)
  const [rebuilding, setReconstruction] = useState<'inactif' | 'watching' | 'fait'>(
    'inactif',
  )

  const measure = useCallback(async () => {
    const states = await events.allMediaStates()
    const byMedia = new Map<MediaRef, readonly StoredEvent[]>()

    for (const etat of states) {
      byMedia.set(etat.ref, await events.eventsForMedia(etat.ref))
    }

    setMesures(metrics(byMedia))
  }, [events])

  useEffect(() => {
    void measure()
  }, [measure])

  async function rebuild() {
    setReconstruction('watching')
    await events.rebuildAllState()
    await measure()
    setReconstruction('fait')
  }

  return (
    <div className="mx-auto max-w-md px-5 py-8 font-mono text-xs text-muted">
      <h1 className="mb-4 text-sm text-text">{t('debug.title')}</h1>

      {measures === null ? (
        <p>{t('debug.measuring')}</p>
      ) : (
        <dl className="space-y-1">
          <Metric name={t('debug.mediaCount')} value={measures.mediaCount} />
          <Metric
            name={t('debug.cyclesBeyondFirst')}
            value={measures.cyclesBeyondFirst}
            warning={measures.cyclesBeyondFirst === 0 && measures.mediaCount > 0}
          />
          <Metric name={t('debug.journalEntries')} value={measures.journalEntries} />
          <Metric name={t('debug.entriesPerDay')} value={measures.entriesPerDay} />
          <Metric name={t('debug.voidedEvents')} value={measures.voidedEvents} />
          <Metric
            name={t('debug.unknownEvents')}
            value={measures.unknownEvents.reduce((total, e) => total + e.count, 0)}
            warning={measures.unknownEvents.length > 0}
          />
          {measures.unknownEvents.map((unknown) => (
            <Metric
              key={unknown.type}
              name={`  └ ${unknown.type}`}
              value={unknown.count}
            />
          ))}
        </dl>
      )}

      <button
        type="button"
        onClick={() => void rebuild()}
        disabled={rebuilding === 'watching'}
        className="mt-6 rounded-action border border-border px-3 py-2 text-left text-[11px] text-text disabled:opacity-40"
      >
        {rebuilding === 'watching'
          ? t('debug.rebuilding')
          : t('debug.rebuild')}
      </button>

      {rebuilding === 'fait' && <p className="mt-2 text-accent">{t('debug.rebuilt')}</p>}

      <p className="mt-6 leading-relaxed text-subtle">{t('debug.note')}</p>
    </div>
  )
}

function Metric({
  name,
  value,
  warning = false,
}: {
  name: string
  value: number
  warning?: boolean
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="whitespace-pre">{name}</dt>
      <dd className={warning ? 'text-status-watch' : 'text-text'}>{value}</dd>
    </div>
  )
}
