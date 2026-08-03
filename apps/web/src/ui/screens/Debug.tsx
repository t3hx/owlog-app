import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { entriesPerDay, metrics, type Metrics, type StoredEvent, type MediaRef } from '@owlog/domain'
import type { SyncStatus } from '@/ports/Sync'
import { useSetting } from '@/ui/hooks/useSetting'
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

      <SyncPanel onPulled={() => void measure()} />
    </div>
  )
}

/**
 * Panneau de synchronisation.
 *
 * Il montre ce que le moteur ne dit nulle part ailleurs : les curseurs, la
 * taille de la file, le dernier passage, la dernière erreur. C'est l'écran
 * qu'on ouvre quand « ça ne synchronise pas » — il doit répondre sans
 * outil de développement.
 *
 * « Re-pousser tout » est le filet : idempotent côté serveur, il remet le
 * journal et le cache entiers en route — l'historique du temps 1 comme un
 * doute sur un ack perdu.
 */
function SyncPanel({ onPulled }: { onPulled: () => void }) {
  const { t } = useTranslation()
  const { sync, live } = usePorts()
  const [status, setStatus] = useState<SyncStatus>(() => sync.status())
  const [repushing, setRepushing] = useState(false)

  useEffect(() => sync.subscribe(() => setStatus(sync.status())), [sync])

  const pending = live.usePendingPushCount()
  const cursor = useSetting('syncCursor')
  const cacheCursor = useSetting('syncCacheCursor')

  async function repush() {
    setRepushing(true)
    try {
      await sync.repushAll()
    } finally {
      setRepushing(false)
    }
  }

  async function syncNow() {
    await sync.syncNow()
    onPulled()
  }

  return (
    <section className="mt-8 border-t border-border pt-6">
      <h2 className="mb-3 text-sm text-text">{t('debug.syncTitle')}</h2>

      <dl className="space-y-1">
        <Metric name={t('debug.syncPending')} value={pending} warning={pending > 0} />
        <Row name={t('debug.syncCursor')} value={cursor.value ?? t('debug.syncNever')} />
        <Row
          name={t('debug.syncCacheCursor')}
          value={cacheCursor.value ?? t('debug.syncNever')}
        />
        <Row
          name={t('debug.syncLastAt')}
          value={status.lastSyncAt ?? t('debug.syncNever')}
        />
        <Row
          name={t('debug.syncError')}
          value={status.lastError ?? t('debug.syncNoError')}
          warning={status.lastError !== null}
        />
      </dl>

      {!status.enabled && (
        <p className="mt-2 text-subtle">
          {status.unauthorized ? t('debug.syncUnauthorized') : t('debug.syncDisabled')}
        </p>
      )}

      <div className="mt-4 flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={status.syncing || !status.enabled}
          className="rounded-action border border-border px-3 py-2 text-left text-[11px] text-text disabled:opacity-40"
        >
          {status.syncing ? t('debug.syncing') : t('debug.syncNow')}
        </button>

        <button
          type="button"
          onClick={() => void repush()}
          disabled={repushing || !status.enabled}
          className="rounded-action border border-border px-3 py-2 text-left text-[11px] text-text disabled:opacity-40"
        >
          {repushing ? t('debug.repushing') : t('debug.repushAll')}
        </button>
      </div>

      <p className="mt-3 leading-relaxed text-subtle">{t('debug.syncNote')}</p>
    </section>
  )
}

function Row({
  name,
  value,
  warning = false,
}: {
  name: string
  value: string
  warning?: boolean
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="whitespace-pre">{name}</dt>
      <dd className={warning ? 'text-status-watch' : 'text-text'}>{value}</dd>
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
