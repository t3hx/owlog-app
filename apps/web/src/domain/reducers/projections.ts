import { applyVoids } from '@/domain/reducers/applyVoids'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import { statutCourant } from '@/domain/rules/statut'
import {
  estConnu,
  type CycleKey,
  type Evenement,
  type EvenementStocke,
  type Horodatage,
} from '@/domain/types'

/** Avancement dans le cycle courant. */
export interface Progression {
  readonly pourcentage: number
  readonly label: string | null
  /** Le label décrit un point plus ancien que la progression affichée. */
  readonly perime: boolean
  readonly majLe: Horodatage | null
}

const AUCUNE_PROGRESSION: Progression = {
  pourcentage: 0,
  label: null,
  perime: false,
  majLe: null,
}

/**
 * Nombre de visionnages aboutis.
 *
 * Un cycle contenant `SEEN` **et** `DROP` ne compte pas : c'est le mis-tap
 * sur la pastille, où un abandon atterrit sur un cycle qui portait déjà sa
 * fin. Sans cette règle, un titre affiché `✕ abandonné` porterait un
 * compteur de visionnages incrémenté.
 */
export function nombreDeVisionnages(evenements: readonly EvenementStocke[]): number {
  return cyclesActifs(evenements).filter((cycle) => cycle.aSeen && !cycle.aDrop).length
}

/**
 * Avancement dans le cycle courant.
 *
 * Rend `0` quand le statut vaut « à voir » : après un bouclage de pastille,
 * le cycle courant reste l'ancien cycle abandonné, et afficher sa
 * progression sur un titre remis à « à voir » serait faux.
 */
export function progression(evenements: readonly EvenementStocke[]): Progression {
  if (statutCourant(evenements) === 'a-voir') return AUCUNE_PROGRESSION

  const courant = cycleCourant(evenements)
  if (!courant) return AUCUNE_PROGRESSION

  const dernier = dernierDuType(courant.evenements, 'PROG')
  if (!dernier || dernier.type !== 'PROG') return AUCUNE_PROGRESSION

  const label = dernier.payload.label ?? null
  const poseLe = dernier.payload.label_created_at ?? null

  return {
    pourcentage: dernier.payload.percent,
    label,
    // Le label a été saisi avant l'événement de progression qui le porte :
    // il décrit un point plus ancien que l'avancement affiché.
    perime: poseLe !== null && poseLe < dernier.created_at,
    majLe: dernier.created_at,
  }
}

/**
 * Note d'un cycle précis.
 *
 * Par cycle et non par média : c'est la thèse du produit, ★3 en 2019 et ★5
 * en 2026 sur le même titre. `null` couvre deux cas indistinguables pour
 * l'affichage — jamais noté, ou note effacée par un re-tap sur la même
 * étoile.
 */
export function note(
  evenements: readonly EvenementStocke[],
  cycle: CycleKey,
): number | null {
  const dernier = dernierDuTypeDansCycle(evenements, cycle, 'RATE')
  if (!dernier || dernier.type !== 'RATE') return null
  return dernier.payload.rating
}

/** Dernier commentaire d'un cycle. */
export function commentaire(
  evenements: readonly EvenementStocke[],
  cycle: CycleKey,
): string | null {
  const dernier = dernierDuTypeDansCycle(evenements, cycle, 'NOTE')
  if (!dernier || dernier.type !== 'NOTE') return null
  return dernier.payload.text
}

/**
 * Coup de cœur.
 *
 * Marqueur transversal, cumulable avec les quatre statuts : il ne remplace
 * jamais la pastille. Départagé par `created_at` et non par la position
 * dans le tableau, qui n'a aucune garantie d'ordre.
 */
export function estCoupDeCoeur(evenements: readonly EvenementStocke[]): boolean {
  let dernier: Evenement | null = null

  for (const evenement of applyVoids(evenements)) {
    if (!estConnu(evenement)) continue
    if (evenement.type !== 'FAV' && evenement.type !== 'UNFAV') continue
    if (dernier === null || evenement.created_at >= dernier.created_at) {
      dernier = evenement
    }
  }

  return dernier?.type === 'FAV'
}

function cyclesActifs(evenements: readonly EvenementStocke[]): readonly Cycle[] {
  return cycles(applyVoids(evenements))
}

function cycleCourant(evenements: readonly EvenementStocke[]): Cycle | undefined {
  const tous = cyclesActifs(evenements)
  return tous[tous.length - 1]
}

/** Dernier événement d'un type donné, par ordre d'écriture. */
function dernierDuType(
  evenements: readonly Evenement[],
  type: Evenement['type'],
): Evenement | undefined {
  let trouve: Evenement | undefined
  for (const evenement of evenements) {
    if (evenement.type !== type) continue
    if (!trouve || evenement.created_at >= trouve.created_at) {
      trouve = evenement
    }
  }
  return trouve
}

function dernierDuTypeDansCycle(
  evenements: readonly EvenementStocke[],
  cycle: CycleKey,
  type: Evenement['type'],
): Evenement | undefined {
  const trouve = cyclesActifs(evenements).find((candidat) => candidat.key === cycle)
  if (!trouve) return undefined
  return dernierDuType(trouve.evenements, type)
}
