import { applyVoids } from '@/domain/reducers/applyVoids'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import { estConnu, type CycleKey, type EvenementStocke, type Horodatage } from '@/domain/types'

/** Marqueur `— visionnage #N —` ouvrant le bloc d'un cycle. */
export interface MarqueurDeCycle {
  readonly genre: 'marqueur'
  readonly numero: number
  readonly cycle: CycleKey
}

/** Une ligne du journal. */
export interface LigneJournal {
  readonly genre: 'evenement'
  readonly evenement: EvenementStocke
  /** Faux pour un type écrit par une version ultérieure du client. */
  readonly connu: boolean
}

export type EntreeJournal = MarqueurDeCycle | LigneJournal

/** Un bloc à positionner : soit un cycle entier, soit un événement isolé. */
interface Bloc {
  readonly cle: Horodatage | null
  readonly entrees: readonly EntreeJournal[]
}

/** Types qui n'apparaissent jamais dans le journal. */
const EXCLUS = new Set<string>(['PROG'])

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
export function journal(evenements: readonly EvenementStocke[]): readonly EntreeJournal[] {
  const actifs = applyVoids(evenements).filter((e) => !EXCLUS.has(e.type))
  const tousLesCycles = cycles(actifs)

  const clesDeCycle = new Set(tousLesCycles.map((cycle) => cycle.key))

  const blocs: Bloc[] = tousLesCycles.map(blocDeCycle)

  for (const evenement of actifs) {
    const cle = evenement.cycle_key
    // Un événement dont le cycle a été reconnu appartient déjà à son bloc.
    if (cle !== null && clesDeCycle.has(cle)) continue

    blocs.push({
      cle: evenement.occurred_at,
      entrees: [{ genre: 'evenement', evenement, connu: estConnu(evenement) }],
    })
  }

  blocs.sort(comparerBlocsDecroissant)

  return blocs.flatMap((bloc) => bloc.entrees)
}

function blocDeCycle(cycle: Cycle): Bloc {
  const lignes = [...cycle.evenements]
    .sort(comparerEvenementsDecroissant)
    .map<LigneJournal>((evenement) => ({ genre: 'evenement', evenement, connu: true }))

  return {
    cle: cycle.dateDeRang,
    entrees: [
      { genre: 'marqueur', numero: cycle.rang, cycle: cycle.key },
      ...lignes,
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
function comparerBlocsDecroissant(a: Bloc, b: Bloc): number {
  if (a.cle === null && b.cle === null) return 0
  if (a.cle === null) return 1
  if (b.cle === null) return -1
  return a.cle < b.cle ? 1 : a.cle > b.cle ? -1 : 0
}

/**
 * Ordre à l'intérieur d'un bloc.
 *
 * Départage par `created_at` puis par `id` : le rétro-datage produit des
 * événements qui partagent exactement la date saisie (un `START` et un
 * `SEEN` posés ensemble), et sans départage leur ordre changerait d'un
 * rendu à l'autre.
 */
function comparerEvenementsDecroissant(a: EvenementStocke, b: EvenementStocke): number {
  const parSurvenue = comparerNullables(a.occurred_at, b.occurred_at)
  if (parSurvenue !== 0) return parSurvenue

  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

function comparerNullables(a: Horodatage | null, b: Horodatage | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? 1 : a > b ? -1 : 0
}
