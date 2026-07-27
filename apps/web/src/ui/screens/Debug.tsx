import { useCallback, useEffect, useState } from 'react'

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
      <h1 className="mb-4 text-sm text-text">/debug</h1>

      {measures === null ? (
        <p>mesure…</p>
      ) : (
        <dl className="space-y-1">
          <Metric name="medias" value={measures.mediaCount} />
          <Metric
            name="cycles_ouverts_au_dela_du_premier"
            value={measures.cyclesBeyondFirst}
            warning={measures.cyclesBeyondFirst === 0 && measures.mediaCount > 0}
          />
          <Metric name="entrees_de_journal" value={measures.journalEntries} />
          <Metric name="entrees_de_journal_par_jour" value={measures.entriesPerDay} />
          <Metric name="evenements_annules" value={measures.voidedEvents} />
          <Metric
            name="evenements_de_type_inconnu"
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
          ? 'reconstruction…'
          : 'reconstruire media_state depuis les evenements'}
      </button>

      {rebuilding === 'fait' && <p className="mt-2 text-accent">reconstruit.</p>}

      <p className="mt-6 leading-relaxed text-subtle">
        media_state est derivee : la rebuild ne perd aucune donnee.
        events est la source de verite et n&apos;est jamais modifiee.
      </p>
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
