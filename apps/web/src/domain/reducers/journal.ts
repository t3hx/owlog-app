import { applyVoids } from '@/domain/reducers/applyVoids'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import { isKnownEvent, type CycleKey, type StoredEvent, type Timestamp } from '@/domain/types'

/** Marqueur `— visionnage #N —` ouvrant le bloc d'un cycle. */
export interface CycleMarker {
  readonly kind: 'marker'
  readonly number: number
  readonly cycle: CycleKey
}

/** Une ligne du journal. */
export interface JournalLine {
  readonly kind: 'event'
  readonly event: StoredEvent
  /** Faux pour un type écrit par une version ultérieure du client. */
  readonly known: boolean
}

export type JournalEntry = CycleMarker | JournalLine

/** Un bloc à positionner : soit un cycle entier, soit un événement isolé. */
interface Block {
  readonly key: Timestamp | null
  readonly entries: readonly JournalEntry[]
}

/** Types qui n'apparaissent jamais dans le journal. */
const EXCLUDED = new Set<string>(['PROG'])

/**
 * Journal d'un média, du plus récent au plus ancien.
 *
 * Trois décisions structurent le rendu :
 *
 * 1. **Un cycle est un bloc contigu**, ouvert par son marqueur
 *    `— visionnage #N —`, et positionné sur sa **date de rang**. C'est la
 *    règle qui gagne quand deux cycles se recouvrent dans le temps.
 *    Positionner le bloc sur le maximum des dates de ses événements
 *    ferait remonter un visionnage de 2019 au-dessus d'un cycle en cours
 *    de 2026 dès qu'on le commente aujourd'hui.
 * 2. **Les événements hors cycle sont des blocs d'un seul élément**, placés
 *    à leur position chronologique, sans marqueur.
 * 3. **Les dates inconnues vont en fin de liste.** On ne peut pas les
 *    placer chronologiquement, et les mettre en tête ferait croire qu'elles
 *    sont récentes.
 *
 * `PROG` est exclu : c'est le seul type sans valeur historique. Le store
 * reste append-only, on filtre à l'affichage.
 */
export function journal(events: readonly StoredEvent[]): readonly JournalEntry[] {
  const active = applyVoids(events).filter((e) => !EXCLUDED.has(e.type))
  const allCycles = cycles(active)

  const cycleKeys = new Set(allCycles.map((cycle) => cycle.key))

  const blocks: Block[] = allCycles.map(cycleBlock)

  for (const event of active) {
    const key = event.cycle_key
    // Un événement dont le cycle a été reconnu appartient déjà à son bloc.
    if (key !== null && cycleKeys.has(key)) continue

    blocks.push({
      key: event.occurred_at,
      entries: [{ kind: 'event', event, known: isKnownEvent(event) }],
    })
  }

  blocks.sort(compareBlocksDesc)

  return blocks.flatMap((block) => block.entries)
}

function cycleBlock(cycle: Cycle): Block {
  const rows = [...cycle.events]
    .sort(compareEventsDesc)
    .map<JournalLine>((event) => ({ kind: 'event', event, known: true }))

  return {
    key: cycle.rankDate,
    entries: [
      { kind: 'marker', number: cycle.rank, cycle: cycle.key },
      ...rows,
    ],
  }
}

/**
 * Ordre d'affichage des blocs : du plus récent au plus ancien.
 *
 * Les blocs sans date passent en dernier. C'est l'inverse de leur rang, où
 * ils passent en premier — et c'est voulu : au rang, « je ne sais plus
 * quand » est nécessairement ancien ; à l'affichage, on ne peut pas le
 * placer, donc on le sort de la chronologie plutôt que de mentir.
 */
function compareBlocksDesc(a: Block, b: Block): number {
  if (a.key === null && b.key === null) return 0
  if (a.key === null) return 1
  if (b.key === null) return -1
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0
}

/**
 * Ordre à l'intérieur d'un bloc.
 *
 * Départage par `created_at` puis par `id` : le rétro-datage produit des
 * événements qui partagent exactement la date saisie (un `START` et un
 * `SEEN` posés ensemble), et sans départage leur ordre changerait d'un
 * rendu à l'autre.
 */
function compareEventsDesc(a: StoredEvent, b: StoredEvent): number {
  const byOccurrence = compareNullable(a.occurred_at, b.occurred_at)
  if (byOccurrence !== 0) return byOccurrence

  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

function compareNullable(a: Timestamp | null, b: Timestamp | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? 1 : a > b ? -1 : 0
}
