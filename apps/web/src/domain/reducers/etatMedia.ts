import { applyVoids } from '@/domain/reducers/applyVoids'
import {
  commentaire,
  estCoupDeCoeur,
  nombreDeVisionnages,
  note as noteDuCycle,
  progression,
} from '@/domain/reducers/projections'
import { cycles } from '@/domain/rules/cycles'
import { statutCourant } from '@/domain/rules/statut'
import type {
  CycleKey,
  EtatMedia,
  EvenementStocke,
  Horodatage,
  MediaRef,
  Statut,
} from '@/domain/types'

/** Une ligne de la table dérivée `media_state`. */
export interface LigneEtat {
  readonly ref: MediaRef
  readonly statut: EtatMedia
  readonly pourcentage: number
  readonly label: string | null
  readonly labelPerime: boolean
  readonly note: number | null
  readonly commentaire: string | null
  readonly coupDeCoeur: boolean
  readonly nombreDeVisionnages: number
  readonly cycleCourant: CycleKey | null
  readonly majLe: Horodatage | null
}

export interface VueBibliotheque {
  readonly lignes: readonly LigneEtat[]
  readonly compteurs: Record<Statut | 'tous' | 'coupsDeCoeur', number>
}

/**
 * Unique producteur de la table `media_state`.
 *
 * Recalculé à chaque `append` concernant ce média, par le domaine et jamais
 * par l'adaptateur : sinon la règle de dérivation du statut existerait à
 * deux endroits.
 *
 * La fonction est pure et indépendante de l'ordre du tableau d'entrée, ce
 * qui est la propriété qui rend la reconstruction intégrale possible :
 * rejouer tout le store doit produire exactement l'état accumulé événement
 * par événement.
 */
export function etatMedia(
  evenements: readonly EvenementStocke[],
  ref: MediaRef,
): LigneEtat {
  const actifs = applyVoids(evenements)
  const tousLesCycles = cycles(actifs)
  const courant = tousLesCycles[tousLesCycles.length - 1] ?? null
  const avancement = progression(evenements)

  return {
    ref,
    statut: statutCourant(evenements),
    pourcentage: avancement.pourcentage,
    label: avancement.label,
    labelPerime: avancement.perime,
    note: courant ? noteDuCycle(evenements, courant.key) : null,
    commentaire: courant ? commentaire(evenements, courant.key) : null,
    coupDeCoeur: estCoupDeCoeur(evenements),
    nombreDeVisionnages: nombreDeVisionnages(evenements),
    cycleCourant: courant?.key ?? null,
    majLe: dernierEcritLe(actifs),
  }
}

/**
 * Projection de la bibliothèque.
 *
 * Consomme des lignes `media_state`, jamais le journal brut : c'est ce qui
 * permet au port `EventStore` de rester en forme de requêtes plutôt qu'en
 * forme de vidage, et donc à la promesse Postgres de tenir.
 */
export function bibliotheque(etats: readonly LigneEtat[]): VueBibliotheque {
  const lignes = etats.filter((etat) => etat.statut !== 'absent')

  return {
    lignes,
    compteurs: {
      tous: lignes.length,
      'a-voir': compter(lignes, 'a-voir'),
      'en-cours': compter(lignes, 'en-cours'),
      vu: compter(lignes, 'vu'),
      abandonne: compter(lignes, 'abandonne'),
      // Le coup de cœur n'est pas un statut : il se cumule avec les quatre,
      // donc il se compte à part et la somme des chips dépasse `tous`.
      coupsDeCoeur: lignes.filter((etat) => etat.coupDeCoeur).length,
    },
  }
}

/** Sous-ligne `› N en cours · N à voir` de l'accueil. */
export function compteursAccueil(etats: readonly LigneEtat[]): {
  enCours: number
  aVoir: number
} {
  const lignes = etats.filter((etat) => etat.statut !== 'absent')
  return {
    enCours: compter(lignes, 'en-cours'),
    aVoir: compter(lignes, 'a-voir'),
  }
}

function compter(lignes: readonly LigneEtat[], statut: Statut): number {
  return lignes.filter((ligne) => ligne.statut === statut).length
}

function dernierEcritLe(evenements: readonly EvenementStocke[]): Horodatage | null {
  let dernier: Horodatage | null = null
  for (const evenement of evenements) {
    if (dernier === null || evenement.created_at > dernier) dernier = evenement.created_at
  }
  return dernier
}
