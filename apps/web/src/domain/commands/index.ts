import { applyVoids } from '@/domain/reducers/applyVoids'
import { progress } from '@/domain/reducers/projections'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import { currentStatus } from '@/domain/rules/status'
import type {
  CycleKey,
  DomainEvent,
  StoredEvent,
  Timestamp,
  MediaRef,
  DatePrecision,
} from '@/domain/types'
import type { IdGenerator, Clock } from '@/ports/Clock'

/**
 * Contexte d'exécution d'une commande.
 *
 * Une commande est une fonction pure : elle reçoit l'état existant et les
 * ports dont elle a besoin, et rend les événements à écrire. Elle n'écrit
 * rien elle-même — c'est l'appelant qui les passe au store, en une seule
 * transaction.
 */
export interface CommandContext {
  readonly events: readonly StoredEvent[]
  readonly mediaRef: MediaRef
  readonly clock: Clock
  readonly ids: IdGenerator
}

/** Saisie d'un visionnage passé. */
export interface BackdateEntry {
  readonly date: Timestamp | null
  readonly precision: DatePrecision
  readonly note?: number | null
  readonly comment?: string
}

/** Ajoute le média à la bibliothèque, en « à voir ». */
export function addToLibrary(context: CommandContext): readonly DomainEvent[] {
  return [liveEvent(context, { type: 'WATCH', cycle_key: null })]
}

/**
 * Fait avancer la pastille d'un cran.
 *
 * `à voir` → `en cours` → `vu` → `abandonné` → `à voir`. Les trois premiers
 * pas agissent sur un cycle ; le dernier écrit un `WATCH` **hors cycle**,
 * ce qui est ce qui permet au rebouclage de ne pas toucher à l'historique.
 */
export function advanceStatus(context: CommandContext): readonly DomainEvent[] {
  const status = currentStatus(context.events)
  const current = currentCycle(context.events)

  switch (status) {
    case 'absent':
    case 'dropped':
      return [liveEvent(context, { type: 'WATCH', cycle_key: null })]

    case 'to-watch':
      return [liveEvent(context, { type: 'START', cycle_key: context.ids.next() })]

    case 'watching':
      return current ? [liveEvent(context, { type: 'SEEN', cycle_key: current.key })] : []

    case 'seen':
      return current ? [liveEvent(context, { type: 'DROP', cycle_key: current.key })] : []
  }
}

/**
 * Avance la progression du cycle courant.
 *
 * Trois comportements qui ne se devinent pas :
 *
 * - **Si aucun cycle n'est ouvert, on en ouvre un.** Faire avancer un titre
 *   implique qu'on est en train de le regarder ; refuser le geste
 *   obligerait à taper d'abord sur la pastille, ce qui contredit
 *   l'objectif produit.
 * - **La progression est bornée à 100.**
 * - **Atteindre 100 émet un `SEEN`** sur le cycle courant, conformément au
 *   handoff : « à 100 % → passe vu, +1 visionnage ».
 *
 * Le label voyage avec sa date d'origine. C'est ce qui permet de savoir
 * qu'un `S02E05` décrit un point plus ancien que l'avancement affiché, et
 * donc de le griser au lieu de laisser croire qu'il est à jour.
 */
export function advanceProgress(
  context: CommandContext,
  options: { increment: number; label?: string },
): readonly DomainEvent[] {
  const status = currentStatus(context.events)
  const existant = currentCycle(context.events)
  const isOpen = existant !== null && status !== 'to-watch' && status !== 'absent'

  const produced: DomainEvent[] = []
  let key: CycleKey

  if (isOpen && existant) {
    key = existant.key
  } else {
    const opening = liveEvent(context, { type: 'START', cycle_key: context.ids.next() })
    produced.push(opening)
    key = opening.cycle_key as CycleKey
  }

  const previous = isOpen ? progress(context.events) : null
  const percent = Math.min(100, (previous?.percent ?? 0) + options.increment)

  const at = context.clock.now()
  const label = options.label ?? previous?.label ?? undefined
  const labelPoseLe =
    options.label !== undefined
      ? at
      : label === undefined
        ? undefined
        : (previous?.updatedAt ?? undefined)

  produced.push(
    build(
      context,
      {
        type: 'PROG',
        cycle_key: key,
        payload: {
          percent: percent,
          ...(label === undefined ? {} : { label }),
          ...(labelPoseLe === undefined ? {} : { label_created_at: labelPoseLe }),
        },
      },
      at,
      { occurred_at: at, occurred_precision: 'exact' },
    ),
  )

  if (percent >= 100) {
    produced.push(liveEvent(context, { type: 'SEEN', cycle_key: key }))
  }

  return produced
}

/**
 * Enregistre un visionnage passé.
 *
 * **Règle de rattachement.** Si le média a un cycle courant encore ouvert
 * (ni `SEEN` ni `DROP`) dont la date de rang **précède** la date saisie, la
 * commande écrit un `SEEN` sur ce cycle existant : l'utilisateur dit « en
 * fait je l'ai fini la semaine dernière », il clôt le visionnage en cours,
 * il n'en ouvre pas un second.
 *
 * Sans cette règle, dire « je l'ai fini » laisserait le cycle #1 ouvert à
 * vie et créerait un cycle #2 clos : l'écran afficherait `✓ vu ×1` face à
 * un `— visionnage #2 —` et un `— visionnage #1 —` sans fin.
 */
export function backdate(context: CommandContext, entry: BackdateEntry): readonly DomainEvent[] {
  const produced: DomainEvent[] = []

  if (currentStatus(context.events) === 'absent') {
    produced.push(liveEvent(context, { type: 'WATCH', cycle_key: null }))
  }

  const attachable = openCycleStartedBefore(context.events, entry.date)
  const key = attachable?.key ?? context.ids.next()

  const date = {
    occurred_at: entry.date,
    occurred_precision: entry.precision,
  }

  if (!attachable) {
    produced.push(pastEvent(context, { type: 'START', cycle_key: key }, date))
  }

  produced.push(pastEvent(context, { type: 'SEEN', cycle_key: key }, date))

  if (entry.note !== undefined) {
    produced.push(
      pastEvent(
        context,
        { type: 'RATE', cycle_key: key, payload: { rating: entry.note } },
        date,
      ),
    )
  }

  if (entry.comment !== undefined) {
    produced.push(
      pastEvent(
        context,
        { type: 'NOTE', cycle_key: key, payload: { text: entry.comment } },
        date,
      ),
    )
  }

  return produced
}

/** Relance un visionnage. Minte toujours un cycle neuf, ne rouvre jamais. */
export function rewatch(context: CommandContext): readonly DomainEvent[] {
  return [liveEvent(context, { type: 'REWATCH', cycle_key: context.ids.next() })]
}

/** Note le cycle courant. `null` efface — c'est le re-tap sur l'étoile. */
export function rate(context: CommandContext, note: number | null): readonly DomainEvent[] {
  return onCurrentCycle(context, (key) => ({
    type: 'RATE',
    cycle_key: key,
    payload: { rating: note },
  }))
}

/** Commente le cycle courant. */
export function addComment(context: CommandContext, texte: string): readonly DomainEvent[] {
  return onCurrentCycle(context, (key) => ({
    type: 'NOTE',
    cycle_key: key,
    payload: { text: texte },
  }))
}

/**
 * Bascule le coup de cœur.
 *
 * Jamais rattaché à un cycle : c'est un marqueur transversal, il ne
 * remplace jamais la pastille et ne dépend d'aucun visionnage.
 */
export function toggleFavorite(context: CommandContext): readonly DomainEvent[] {
  const active = lastFavoriteMark(context.events) === 'FAV'
  return [liveEvent(context, { type: active ? 'UNFAV' : 'FAV', cycle_key: null })]
}

/** Retire le média de la bibliothèque, sans effacer son historique. */
export function removeFromLibrary(context: CommandContext): readonly DomainEvent[] {
  return [liveEvent(context, { type: 'REMOVE', cycle_key: null })]
}

/** Annule un événement par son identifiant. */
export function undo(context: CommandContext, target: string): readonly DomainEvent[] {
  return [liveEvent(context, { type: 'VOID', cycle_key: null, payload: { target: target } })]
}

// --- Fabrication des événements -------------------------------------------

type EventBody = Pick<DomainEvent, 'type' | 'cycle_key'> & { payload?: unknown }

/**
 * Événement produit par un geste dans l'app.
 *
 * `occurred_at = created_at` et précision `exact`. Sans cette règle, un
 * `START` live laissé sans date serait classé avant tous les autres cycles.
 */
function liveEvent(context: CommandContext, corps: EventBody): DomainEvent {
  const at = context.clock.now()
  return build(context, corps, at, {
    occurred_at: at,
    occurred_precision: 'exact',
  })
}

/** Événement décrivant un moment passé, avec sa précision assumée. */
function pastEvent(
  context: CommandContext,
  corps: EventBody,
  date: { occurred_at: Timestamp | null; occurred_precision: DatePrecision },
): DomainEvent {
  return build(context, corps, context.clock.now(), date)
}

function build(
  context: CommandContext,
  corps: EventBody,
  writtenAt: Timestamp,
  date: { occurred_at: Timestamp | null; occurred_precision: DatePrecision },
): DomainEvent {
  return {
    id: context.ids.next(),
    device_id: 'local',
    created_at: writtenAt,
    media_ref: context.mediaRef,
    ...date,
    ...corps,
  } as DomainEvent
}

// --- Lectures utilitaires --------------------------------------------------

function activeCycles(events: readonly StoredEvent[]): readonly Cycle[] {
  return cycles(applyVoids(events))
}

function currentCycle(events: readonly StoredEvent[]): Cycle | null {
  const all = activeCycles(events)
  return all[all.length - 1] ?? null
}

/**
 * Le cycle courant est-il ouvert et antérieur à la date saisie ?
 *
 * Une date de saisie `null` (précision inconnue) ne se compare à rien : on
 * ne rattache pas, on minte un cycle neuf. Rattacher au jugé fusionnerait
 * deux visionnages distincts sans que rien ne le signale.
 */
function openCycleStartedBefore(
  events: readonly StoredEvent[],
  date: Timestamp | null,
): Cycle | null {
  if (date === null) return null

  const current = currentCycle(events)
  if (!current) return null
  if (current.hasSeen || current.hasDrop) return null
  if (current.rankDate === null) return null

  return current.rankDate < date ? current : null
}

/**
 * Applique une commande au cycle courant, en l'ouvrant s'il n'existe pas.
 *
 * Noter ou commenter un titre jamais commencé implique qu'on l'a vu : le
 * refuser obligerait à taper sur la pastille d'abord, pour un geste qui
 * exprime déjà l'intention.
 */
function onCurrentCycle(
  context: CommandContext,
  corps: (key: CycleKey) => EventBody,
): readonly DomainEvent[] {
  const current = currentCycle(context.events)
  if (current) return [liveEvent(context, corps(current.key))]

  const key = context.ids.next()
  return [
    liveEvent(context, { type: 'START', cycle_key: key }),
    liveEvent(context, corps(key)),
  ]
}

function lastFavoriteMark(events: readonly StoredEvent[]): string | null {
  let last: StoredEvent | null = null
  for (const event of applyVoids(events)) {
    if (event.type !== 'FAV' && event.type !== 'UNFAV') continue
    if (last === null || event.created_at >= last.created_at) last = event
  }
  return last?.type ?? null
}
