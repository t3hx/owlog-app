import { applyVoids } from '@/domain/reducers/applyVoids'
import { progression } from '@/domain/reducers/projections'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import { statutCourant } from '@/domain/rules/statut'
import type {
  CycleKey,
  Evenement,
  EvenementStocke,
  Horodatage,
  MediaRef,
  Precision,
} from '@/domain/types'
import type { GenerateurId, Horloge } from '@/ports/Horloge'

/**
 * Contexte d'exécution d'une commande.
 *
 * Une commande est une fonction pure : elle reçoit l'état existant et les
 * ports dont elle a besoin, et rend les événements à écrire. Elle n'écrit
 * rien elle-même — c'est l'appelant qui les passe au store, en une seule
 * transaction.
 */
export interface Contexte {
  readonly evenements: readonly EvenementStocke[]
  readonly mediaRef: MediaRef
  readonly horloge: Horloge
  readonly ids: GenerateurId
}

/** Saisie d'un visionnage passé. */
export interface SaisieRetro {
  readonly date: Horodatage | null
  readonly precision: Precision
  readonly note?: number | null
  readonly commentaire?: string
}

/** Ajoute le média à la bibliothèque, en « à voir ». */
export function ajouter(contexte: Contexte): readonly Evenement[] {
  return [live(contexte, { type: 'WATCH', cycle_key: null })]
}

/**
 * Fait avancer la pastille d'un cran.
 *
 * `à voir` → `en cours` → `vu` → `abandonné` → `à voir`. Les trois premiers
 * pas agissent sur un cycle ; le dernier écrit un `WATCH` **hors cycle**,
 * ce qui est ce qui permet au rebouclage de ne pas toucher à l'historique.
 */
export function avancerStatut(contexte: Contexte): readonly Evenement[] {
  const statut = statutCourant(contexte.evenements)
  const courant = cycleCourant(contexte.evenements)

  switch (statut) {
    case 'absent':
    case 'abandonne':
      return [live(contexte, { type: 'WATCH', cycle_key: null })]

    case 'a-voir':
      return [live(contexte, { type: 'START', cycle_key: contexte.ids.suivant() })]

    case 'en-cours':
      return courant ? [live(contexte, { type: 'SEEN', cycle_key: courant.key })] : []

    case 'vu':
      return courant ? [live(contexte, { type: 'DROP', cycle_key: courant.key })] : []
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
export function progresser(
  contexte: Contexte,
  options: { increment: number; label?: string },
): readonly Evenement[] {
  const statut = statutCourant(contexte.evenements)
  const existant = cycleCourant(contexte.evenements)
  const ouvert = existant !== null && statut !== 'a-voir' && statut !== 'absent'

  const produits: Evenement[] = []
  let cle: CycleKey

  if (ouvert && existant) {
    cle = existant.key
  } else {
    const ouverture = live(contexte, { type: 'START', cycle_key: contexte.ids.suivant() })
    produits.push(ouverture)
    cle = ouverture.cycle_key as CycleKey
  }

  const precedente = ouvert ? progression(contexte.evenements) : null
  const pourcentage = Math.min(100, (precedente?.pourcentage ?? 0) + options.increment)

  const instant = contexte.horloge.maintenant()
  const label = options.label ?? precedente?.label ?? undefined
  const labelPoseLe =
    options.label !== undefined
      ? instant
      : label === undefined
        ? undefined
        : (precedente?.majLe ?? undefined)

  produits.push(
    assembler(
      contexte,
      {
        type: 'PROG',
        cycle_key: cle,
        payload: {
          percent: pourcentage,
          ...(label === undefined ? {} : { label }),
          ...(labelPoseLe === undefined ? {} : { label_created_at: labelPoseLe }),
        },
      },
      instant,
      { occurred_at: instant, occurred_precision: 'exact' },
    ),
  )

  if (pourcentage >= 100) {
    produits.push(live(contexte, { type: 'SEEN', cycle_key: cle }))
  }

  return produits
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
export function retroDater(contexte: Contexte, saisie: SaisieRetro): readonly Evenement[] {
  const produits: Evenement[] = []

  if (statutCourant(contexte.evenements) === 'absent') {
    produits.push(live(contexte, { type: 'WATCH', cycle_key: null }))
  }

  const rattachable = cycleOuvertAnterieurA(contexte.evenements, saisie.date)
  const cle = rattachable?.key ?? contexte.ids.suivant()

  const date = {
    occurred_at: saisie.date,
    occurred_precision: saisie.precision,
  }

  if (!rattachable) {
    produits.push(passe(contexte, { type: 'START', cycle_key: cle }, date))
  }

  produits.push(passe(contexte, { type: 'SEEN', cycle_key: cle }, date))

  if (saisie.note !== undefined) {
    produits.push(
      passe(
        contexte,
        { type: 'RATE', cycle_key: cle, payload: { rating: saisie.note } },
        date,
      ),
    )
  }

  if (saisie.commentaire !== undefined) {
    produits.push(
      passe(
        contexte,
        { type: 'NOTE', cycle_key: cle, payload: { text: saisie.commentaire } },
        date,
      ),
    )
  }

  return produits
}

/** Relance un visionnage. Minte toujours un cycle neuf, ne rouvre jamais. */
export function revoir(contexte: Contexte): readonly Evenement[] {
  return [live(contexte, { type: 'REWATCH', cycle_key: contexte.ids.suivant() })]
}

/** Note le cycle courant. `null` efface — c'est le re-tap sur l'étoile. */
export function noter(contexte: Contexte, note: number | null): readonly Evenement[] {
  return surLeCycleCourant(contexte, (cle) => ({
    type: 'RATE',
    cycle_key: cle,
    payload: { rating: note },
  }))
}

/** Commente le cycle courant. */
export function commenter(contexte: Contexte, texte: string): readonly Evenement[] {
  return surLeCycleCourant(contexte, (cle) => ({
    type: 'NOTE',
    cycle_key: cle,
    payload: { text: texte },
  }))
}

/**
 * Bascule le coup de cœur.
 *
 * Jamais rattaché à un cycle : c'est un marqueur transversal, il ne
 * remplace jamais la pastille et ne dépend d'aucun visionnage.
 */
export function basculerCoupDeCoeur(contexte: Contexte): readonly Evenement[] {
  const actif = derniereMarqueDeCoeur(contexte.evenements) === 'FAV'
  return [live(contexte, { type: actif ? 'UNFAV' : 'FAV', cycle_key: null })]
}

/** Retire le média de la bibliothèque, sans effacer son historique. */
export function retirer(contexte: Contexte): readonly Evenement[] {
  return [live(contexte, { type: 'REMOVE', cycle_key: null })]
}

/** Annule un événement par son identifiant. */
export function annuler(contexte: Contexte, cible: string): readonly Evenement[] {
  return [live(contexte, { type: 'VOID', cycle_key: null, payload: { target: cible } })]
}

// --- Fabrication des événements -------------------------------------------

type Corps = Pick<Evenement, 'type' | 'cycle_key'> & { payload?: unknown }

/**
 * Événement produit par un geste dans l'app.
 *
 * `occurred_at = created_at` et précision `exact`. Sans cette règle, un
 * `START` live laissé sans date serait classé avant tous les autres cycles.
 */
function live(contexte: Contexte, corps: Corps): Evenement {
  const instant = contexte.horloge.maintenant()
  return assembler(contexte, corps, instant, {
    occurred_at: instant,
    occurred_precision: 'exact',
  })
}

/** Événement décrivant un moment passé, avec sa précision assumée. */
function passe(
  contexte: Contexte,
  corps: Corps,
  date: { occurred_at: Horodatage | null; occurred_precision: Precision },
): Evenement {
  return assembler(contexte, corps, contexte.horloge.maintenant(), date)
}

function assembler(
  contexte: Contexte,
  corps: Corps,
  ecritLe: Horodatage,
  date: { occurred_at: Horodatage | null; occurred_precision: Precision },
): Evenement {
  return {
    id: contexte.ids.suivant(),
    device_id: 'local',
    created_at: ecritLe,
    media_ref: contexte.mediaRef,
    ...date,
    ...corps,
  } as Evenement
}

// --- Lectures utilitaires --------------------------------------------------

function cyclesActifs(evenements: readonly EvenementStocke[]): readonly Cycle[] {
  return cycles(applyVoids(evenements))
}

function cycleCourant(evenements: readonly EvenementStocke[]): Cycle | null {
  const tous = cyclesActifs(evenements)
  return tous[tous.length - 1] ?? null
}

/**
 * Le cycle courant est-il ouvert et antérieur à la date saisie ?
 *
 * Une date de saisie `null` (précision inconnue) ne se compare à rien : on
 * ne rattache pas, on minte un cycle neuf. Rattacher au jugé fusionnerait
 * deux visionnages distincts sans que rien ne le signale.
 */
function cycleOuvertAnterieurA(
  evenements: readonly EvenementStocke[],
  date: Horodatage | null,
): Cycle | null {
  if (date === null) return null

  const courant = cycleCourant(evenements)
  if (!courant) return null
  if (courant.aSeen || courant.aDrop) return null
  if (courant.dateDeRang === null) return null

  return courant.dateDeRang < date ? courant : null
}

/**
 * Applique une commande au cycle courant, en l'ouvrant s'il n'existe pas.
 *
 * Noter ou commenter un titre jamais commencé implique qu'on l'a vu : le
 * refuser obligerait à taper sur la pastille d'abord, pour un geste qui
 * exprime déjà l'intention.
 */
function surLeCycleCourant(
  contexte: Contexte,
  corps: (cle: CycleKey) => Corps,
): readonly Evenement[] {
  const courant = cycleCourant(contexte.evenements)
  if (courant) return [live(contexte, corps(courant.key))]

  const cle = contexte.ids.suivant()
  return [
    live(contexte, { type: 'START', cycle_key: cle }),
    live(contexte, corps(cle)),
  ]
}

function derniereMarqueDeCoeur(evenements: readonly EvenementStocke[]): string | null {
  let dernier: EvenementStocke | null = null
  for (const evenement of applyVoids(evenements)) {
    if (evenement.type !== 'FAV' && evenement.type !== 'UNFAV') continue
    if (dernier === null || evenement.created_at >= dernier.created_at) dernier = evenement
  }
  return dernier?.type ?? null
}
