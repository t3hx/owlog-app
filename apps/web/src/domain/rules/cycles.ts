import {
  estConnu,
  ouvreUnCycle,
  type CycleKey,
  type Evenement,
  type EvenementStocke,
  type Horodatage,
} from '@/domain/types'

/**
 * Un cycle de visionnage, avec son rang.
 *
 * `rang` est dérivé, jamais stocké. Le stocker obligerait à renuméroter des
 * événements existants dès qu'un visionnage antérieur est saisi après coup,
 * ce que l'append-only interdit.
 */
export interface Cycle {
  readonly key: CycleKey
  /** `occurred_at` de l'événement d'ouverture. `null` si précision inconnue. */
  readonly dateDeRang: Horodatage | null
  /** Position chronologique, 1-indexée. C'est le `#N` affiché. */
  readonly rang: number
  readonly evenements: readonly Evenement[]
  readonly aSeen: boolean
  readonly aDrop: boolean
  /** Vrai si aucun `START`/`REWATCH` — synchronisation partielle. */
  readonly ouvertureManquante: boolean
}

/**
 * Groupe les événements par cycle et les ordonne par rang.
 *
 * **La date de rang d'un cycle est l'`occurred_at` de son événement
 * d'ouverture.** Une seule définition, trois consommateurs : la
 * numérotation `#N`, la dérivation du statut, le tri du journal.
 *
 * Départage : date de rang, puis `created_at`, puis `id`. Nécessaire et pas
 * théorique — vingt titres rétro-datés à l'année produisent des dates
 * identiques, et sans départage le `#N` affiché serait non déterministe
 * d'un rendu à l'autre.
 *
 * Les cycles sans date (précision `inconnu`) passent **avant** tous les
 * autres : « je ne sais plus quand » est nécessairement plus ancien que
 * n'importe quelle date connue, sans quoi ils s'intercaleraient au hasard.
 *
 * Les types inconnus sont ignorés, jamais une exception : au temps 2, deux
 * appareils tourneront sur deux versions du client.
 */
export function cycles(evenements: readonly EvenementStocke[]): readonly Cycle[] {
  const parCycle = new Map<CycleKey, Evenement[]>()

  for (const evenement of evenements) {
    if (!estConnu(evenement)) continue
    if (evenement.cycle_key === null) continue

    const existants = parCycle.get(evenement.cycle_key)
    if (existants) {
      existants.push(evenement)
    } else {
      parCycle.set(evenement.cycle_key, [evenement])
    }
  }

  const construits = [...parCycle.entries()].map(([key, evenementsDuCycle]) =>
    construireCycle(key, evenementsDuCycle),
  )

  construits.sort(comparerParRang)

  return construits.map((cycle, index) => ({ ...cycle, rang: index + 1 }))
}

/** Ce qui sert à ordonner, avant que le rang final ne soit attribué. */
type CycleSansRang = Omit<Cycle, 'rang'> & {
  /** Retenu pour le départage : `created_at` de l'événement d'ouverture. */
  readonly ecritLe: Horodatage
  readonly idOuverture: string
}

function construireCycle(key: CycleKey, evenements: Evenement[]): CycleSansRang & { rang: number } {
  const ouverture = evenements.find(ouvreUnCycle)

  // Sans événement d'ouverture — synchronisation partielle — on retient le
  // plus ancien événement écrit du cycle. La donnée de l'utilisateur est
  // conservée et classée approximativement, plutôt que perdue.
  const reference =
    ouverture ??
    [...evenements].sort((a, b) => comparerChaines(a.created_at, b.created_at))[0]

  if (!reference) {
    throw new Error(`Cycle ${key} sans aucun événement, ce qui est impossible`)
  }

  return {
    key,
    dateDeRang: reference.occurred_at,
    rang: 0,
    evenements,
    aSeen: evenements.some((e) => e.type === 'SEEN'),
    aDrop: evenements.some((e) => e.type === 'DROP'),
    ouvertureManquante: ouverture === undefined,
    ecritLe: reference.created_at,
    idOuverture: reference.id,
  }
}

function comparerParRang(a: CycleSansRang, b: CycleSansRang): number {
  if (a.dateDeRang === null && b.dateDeRang !== null) return -1
  if (a.dateDeRang !== null && b.dateDeRang === null) return 1

  if (a.dateDeRang !== null && b.dateDeRang !== null) {
    const parDate = comparerChaines(a.dateDeRang, b.dateDeRang)
    if (parDate !== 0) return parDate
  }

  const parEcriture = comparerChaines(a.ecritLe, b.ecritLe)
  if (parEcriture !== 0) return parEcriture

  return comparerChaines(a.idOuverture, b.idOuverture)
}

/**
 * Compare deux horodatages ISO 8601 en UTC.
 *
 * Comparaison lexicographique et non `Date.parse` : le format ISO en UTC
 * est trié correctement tel quel, et parser reviendrait à faire confiance
 * au fuseau du navigateur pour une donnée qui n'en dépend pas.
 */
function comparerChaines(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
