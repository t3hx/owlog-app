import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { entriesPerDay, metrics, type Metrics } from '@/domain/reducers/metrics'
import type { StoredEvent, MediaRef } from '@/domain/types'
import { useBackup } from '@/ui/hooks/useBackup'
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
/**
 * Jours écoulés entre la première et la dernière écriture.
 *
 * Calculé ici et non dans le réducteur : `Date` est interdit au domaine, et
 * une soustraction d'horodatages le lui ferait connaître. Même partage que
 * les fenêtres de l'écran de stats — l'arithmétique de calendrier reste
 * dehors, la règle reste dedans.
 */
function elapsedDays(measures: Metrics): number {
  if (measures.firstAt === null || measures.lastAt === null) return 0

  const span = new Date(measures.lastAt).getTime() - new Date(measures.firstAt).getTime()
  return span / 86_400_000
}

export function Debug() {
  const { t } = useTranslation()
  const { events } = usePorts()
  const [measures, setMeasures] = useState<Metrics | null>(null)
  const [rebuilding, setRebuilding] = useState<'idle' | 'running' | 'done'>('idle')

  const measure = useCallback(async () => {
    const states = await events.allMediaStates()
    const byMedia = new Map<MediaRef, readonly StoredEvent[]>()

    for (const state of states) {
      byMedia.set(state.ref, await events.eventsForMedia(state.ref))
    }

    setMeasures(metrics(byMedia))
  }, [events])

  useEffect(() => {
    void measure()
  }, [measure])

  async function rebuild() {
    setRebuilding('running')
    await events.rebuildAllState()
    await measure()
    setRebuilding('done')
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
          <Metric
            name={t('debug.entriesPerDay')}
            value={entriesPerDay(measures.journalEntries, elapsedDays(measures))}
          />
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
        disabled={rebuilding === 'running'}
        className="mt-6 rounded-action border border-border px-3 py-2 text-left text-[11px] text-text disabled:opacity-40"
      >
        {rebuilding === 'running'
          ? t('debug.rebuilding')
          : t('debug.rebuild')}
      </button>

      {rebuilding === 'done' && <p className="mt-2 text-accent">{t('debug.rebuilt')}</p>}

      <p className="mt-6 leading-relaxed text-subtle">{t('debug.note')}</p>

      <Backup onRestored={() => void measure()} />
    </div>
  )
}

/**
 * Export et import du `.log`.
 *
 * Il vit sur `/debug` et non dans un écran de réglages, qui n'existe pas
 * encore. C'est provisoire, mais pas anodin : le filet de sécurité doit
 * exister **avant** la saisie de masse du rétro-datage, pas après.
 */
function Backup({ onRestored }: { onRestored: () => void }) {
  const { t } = useTranslation()
  const { state, exportLog, importLog } = useBackup(onRestored)
  const file = useRef<HTMLInputElement>(null)

  return (
    <section className="mt-8 border-t border-border pt-6">
      <h2 className="mb-3 text-sm text-text">{t('debug.backupTitle')}</h2>

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => void exportLog()}
          disabled={state.status === 'exporting'}
          className="rounded-action border border-border px-3 py-2 text-left text-[11px] text-text disabled:opacity-40"
        >
          {state.status === 'exporting' ? t('debug.exporting') : t('debug.export')}
        </button>

        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={state.status === 'importing'}
          className="rounded-action border border-border px-3 py-2 text-left text-[11px] text-text disabled:opacity-40"
        >
          {state.status === 'importing' ? t('debug.importing') : t('debug.import')}
        </button>

        <input
          ref={file}
          type="file"
          accept=".log,text/plain"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            // Le champ est remis a zero : sans ca, reimporter le meme fichier
            // deux fois de suite n'emet aucun `change` et le bouton parait mort.
            event.target.value = ''
            if (chosen) void importLog(chosen)
          }}
        />
      </div>

      {state.status === 'imported' && (
        <p className="mt-2 text-accent">
          {t('debug.imported', {
            added: state.report.added,
            skipped: state.report.skipped,
          })}
        </p>
      )}

      {state.status === 'failed' && (
        <p className="mt-2 text-status-watch">
          {t('debug.importFailed', { reason: state.reason })}
        </p>
      )}

      <p className="mt-3 leading-relaxed text-subtle">{t('debug.backupNote')}</p>
    </section>
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
