import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { completeCacheRow } from '@/ports/MediaCache'
import { systemClock, uuidv7Generator } from '@/adapters/browser/clock'
import {
  addComment,
  rate,
  rewatch,
  setStatus,
  toggleFavorite,
  undo,
  type CommandContext,
} from '@/domain/commands'
import type { MediaStateRow } from '@/domain/reducers/mediaState'
import type { EventId, MediaRef, Status, StoredEvent } from '@/domain/types'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Page média : lectures réactives et gestes.
 *
 * L'écran ne connaît que ce hook. Toutes les règles restent dans
 * `domain/commands/` — la seule chose qui vit ici est le fait qu'une
 * consultation déclenche un appel réseau, ce qui n'est pas une règle métier.
 */
export function useMedia(ref: MediaRef) {
  const { events, catalog, live, deviceId } = usePorts()
  const { i18n } = useTranslation()

  const journal = live.useMediaEvents(ref)
  const state = live.useMediaState(ref)
  const cache = live.useMediaCacheRow(ref)

  const language = i18n.resolvedLanguage ?? 'fr'

  /**
   * Complète `media_cache` à l'ouverture.
   *
   * La ligne écrite à l'ajout vient d'un résultat de recherche : ni genres,
   * ni durée, ni nombre d'épisodes. C'est ici qu'on les obtient, et le
   * drapeau `complete` empêche les stats de compter une durée absente comme
   * une durée nulle.
   */
  useEffect(() => {
    // `cache` vaut `undefined` tant que la lecture réactive n'a pas rendu :
    // partir tout de suite déclencherait un appel réseau à chaque ouverture,
    // y compris quand la ligne complète est déjà là.
    if (cache === undefined || cache.complete) return

    let cancelled = false

    void (async () => {
      const result = await catalog.detail(ref, language.startsWith('en') ? 'en-US' : 'fr-FR')
      if (cancelled || !result.ok) return

      await events.upsertMediaCache([completeCacheRow(result.value, systemClock.now())])
    })()

    return () => {
      cancelled = true
    }
  }, [ref, cache, language, catalog, events])

  const write = useCallback(
    (command: (context: CommandContext) => readonly StoredEvent[]) => {
      const context: CommandContext = {
        events: journal,
        mediaRef: ref,
        clock: systemClock,
        ids: uuidv7Generator,
        deviceId,
      }

      const produced = command(context)
      if (produced.length === 0) return Promise.resolve()

      return events.append(produced as never)
    },
    [events, journal, ref],
  )

  return {
    journal,
    state,
    cache,
    pickStatus: (target: Status) => write((c) => setStatus(c, target)),
    setRating: (value: number | null) => write((c) => rate(c, value)),
    comment: (text: string) => write((c) => addComment(c, text)),
    toggleFav: () => write(toggleFavorite),
    watchAgain: () => write(rewatch),
    cancel: (target: EventId) => write((c) => undo(c, target)),
  }
}

export type MediaView = ReturnType<typeof useMedia>
export type { MediaStateRow }
