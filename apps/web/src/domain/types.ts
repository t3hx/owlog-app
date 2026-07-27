/**
 * Types du domaine.
 *
 * `Evenement` est une **union discriminée sur `type`**, pas un objet avec un
 * `payload` libre : le compilateur vérifie qu'un `PROG` porte un `percent`,
 * qu'un `RATE` porte un `rating`, qu'un `VOID` porte un `target`. C'est
 * « explicite plutôt que malin » appliqué au seul endroit du modèle qui
 * serait resté du texte libre.
 *
 * L'union contraint aussi `cycle_key` type par type, ce qui rend
 * inexprimable une erreur que la revue avait dû énoncer en prose : un `FAV`
 * ne peut pas porter de cycle, le coup de cœur étant un marqueur
 * transversal.
 */

/** Référence d'un média. Le format est vérifié à la construction. */
export type MediaRef = `tmdb:${'movie' | 'tv'}/${number}`

/** Identifiant d'événement. UUIDv7 : ordonnable par le temps. */
export type EventId = string

/** Identité stable d'un cycle de visionnage. */
export type CycleKey = string

/** Horodatage ISO 8601 en UTC. */
export type Horodatage = string

/**
 * Précision d'une date de survenue.
 *
 * C'est ce qui rend le rétro-datage honnête : « 2019 » et « je ne sais
 * plus » sont des dates légitimes, et l'affichage peut le dire sans mentir.
 * Les agrégations mensuelles excluent tout ce qui est plus grossier que
 * `mois`.
 */
export type Precision = 'exact' | 'jour' | 'mois' | 'annee' | 'inconnu'

interface Commun {
  readonly id: EventId
  readonly device_id: string
  /** Quand l'événement a été écrit. Immuable, fait foi pour l'ordre d'écriture. */
  readonly created_at: Horodatage
  /** Quand ça s'est passé. `null` si la précision est `inconnu`. */
  readonly occurred_at: Horodatage | null
  readonly occurred_precision: Precision
  readonly media_ref: MediaRef
}

/** Rattaché à aucun cycle. */
interface HorsCycle extends Commun {
  readonly cycle_key: null
}

/** Rattaché à un cycle précis. */
interface DansCycle extends Commun {
  readonly cycle_key: CycleKey
}

/** Met le média en « à voir ». Le premier `WATCH` d'un média EST son ajout. */
export interface Watch extends HorsCycle {
  readonly type: 'WATCH'
}

/** Retire le média de la bibliothèque, sans effacer son historique. */
export interface Remove extends HorsCycle {
  readonly type: 'REMOVE'
}

/** Ouvre le premier cycle de visionnage. Minte son `cycle_key`. */
export interface Start extends DansCycle {
  readonly type: 'START'
}

/** Ouvre un cycle supplémentaire. Minte son `cycle_key`. */
export interface Rewatch extends DansCycle {
  readonly type: 'REWATCH'
}

/** Termine un cycle. */
export interface Seen extends DansCycle {
  readonly type: 'SEEN'
}

/** Abandonne un cycle, le rendant terminal. */
export interface Drop extends DansCycle {
  readonly type: 'DROP'
}

/**
 * Avancement dans un cycle.
 *
 * `label` et `label_created_at` voyagent ensemble : la commande recopie le
 * dernier label connu dans chaque `PROG`, avec la date à laquelle il a été
 * saisi. C'est ce qui permet de savoir qu'un label `S02E05` est plus ancien
 * que la progression qu'il accompagne, et donc de l'afficher en gris plutôt
 * que de laisser croire qu'il est à jour.
 */
export interface Prog extends DansCycle {
  readonly type: 'PROG'
  readonly payload: {
    readonly percent: number
    readonly label?: string
    readonly label_created_at?: Horodatage
  }
}

/** Note d'un cycle. `null` efface — c'est le re-tap sur la même étoile. */
export interface Rate extends DansCycle {
  readonly type: 'RATE'
  readonly payload: { readonly rating: number | null }
}

/** Commentaire libre sur un cycle. */
export interface Note extends DansCycle {
  readonly type: 'NOTE'
  readonly payload: { readonly text: string }
}

/** Coup de cœur. Marqueur transversal, jamais rattaché à un cycle. */
export interface Fav extends HorsCycle {
  readonly type: 'FAV'
}

/** Retrait du coup de cœur. */
export interface Unfav extends HorsCycle {
  readonly type: 'UNFAV'
}

/**
 * Annule un événement précis.
 *
 * Sans ce type, « une correction est un nouvel événement » serait affirmé
 * sans moyen de le tenir, et un tap de trop sur la pastille détruirait un
 * visionnage sans recours. Le store reste strictement append-only : on
 * ajoute une annulation, on n'efface jamais.
 *
 * Un `VOID` ne peut pas viser un autre `VOID` — voir `applyVoids`.
 */
export interface Void_ extends HorsCycle {
  readonly type: 'VOID'
  readonly payload: { readonly target: EventId }
}

/** Tout événement que ce code sait interpréter. */
export type Evenement =
  | Watch
  | Remove
  | Start
  | Rewatch
  | Seen
  | Drop
  | Prog
  | Rate
  | Note
  | Fav
  | Unfav
  | Void_

export type TypeEvenement = Evenement['type']

/**
 * Événement d'un type que ce code ne connaît pas.
 *
 * Le store est append-only pour toujours, l'énumération grossira (import
 * CSV, livres, musique), et au temps 2 deux appareils tourneront sur deux
 * versions du client. Un `switch` exhaustif sans ce cas ferait qu'un
 * appareil en retard de version lève une exception et n'affiche plus rien —
 * pas un titre cassé, l'app cassée.
 */
export interface EvenementInconnu extends Commun {
  readonly type: string
  readonly cycle_key: CycleKey | null
  readonly payload?: unknown
}

/** Ce qui sort du store : du connu, et potentiellement de l'inconnu. */
export type EvenementStocke = Evenement | EvenementInconnu

const TYPES_CONNUS = new Set<string>([
  'WATCH',
  'REMOVE',
  'START',
  'REWATCH',
  'SEEN',
  'DROP',
  'PROG',
  'RATE',
  'NOTE',
  'FAV',
  'UNFAV',
  'VOID',
])

/** Discrimine un événement lisible d'un événement d'une version ultérieure. */
export function estConnu(evenement: EvenementStocke): evenement is Evenement {
  return TYPES_CONNUS.has(evenement.type)
}

/** Types qui ouvrent un cycle et mintent son identité. */
export function ouvreUnCycle(evenement: Evenement): evenement is Start | Rewatch {
  return evenement.type === 'START' || evenement.type === 'REWATCH'
}

/** Types qui rendent un cycle terminal. */
export function termineUnCycle(evenement: Evenement): evenement is Seen | Drop {
  return evenement.type === 'SEEN' || evenement.type === 'DROP'
}

/**
 * État d'un média dans la bibliothèque.
 *
 * `absent` n'est pas un statut affichable : c'est l'absence de la
 * bibliothèque, après un `REMOVE`.
 */
export type Statut = 'a-voir' | 'en-cours' | 'vu' | 'abandonne'
export type EtatMedia = Statut | 'absent'
