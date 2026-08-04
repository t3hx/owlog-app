import { z } from 'zod'

import { PSEUDO_PATTERN } from './pseudo.ts'

/**
 * Contrat des surfaces sociales entre `owlog-web` et `owlog-api`.
 *
 * Une validation, deux consommateurs — même principe que `sync.ts` : le
 * serveur valide les corps avec ces schémas, le client construit ses
 * requêtes avec les mêmes formes. Les états de relation, eux, ne sont
 * **jamais** dupliqués dans un état local d'écran : ils sortent d'ici, et
 * le serveur les dérive de ses tables.
 *
 * Ce que ce fichier ne contient pas, et pourquoi : aucune forme d'erreur
 * propre au social. `social.md` annonçait `{ error, code: "pseudo_taken" }` ;
 * le dépôt porte un champ unique où `error` **est** le code
 * (`ApiErrorCode`), et une seconde forme d'erreur pour une seule famille de
 * routes aurait obligé chaque écran à savoir laquelle lire.
 */

/**
 * Ce qu'un compte est pour le lecteur, du point de vue du serveur.
 *
 * **Dérivé des tables, jamais stocké et jamais deviné côté écran.** Le
 * bouton `+ AJOUTER` qui devient `demande envoyée` lit cette valeur ; s'il
 * la déduisait d'un clic, un rechargement de page effacerait l'état.
 *
 * `none` n'est pas `stranger` : `ProfileViewer` (domaine) répond « qu'est-ce
 * que j'ai le droit de voir », `RelationState` (transport) répond « quel
 * geste est offert ». Les confondre mettrait une règle de visibilité dans
 * un état de bouton.
 */
export type RelationState =
  | 'self'
  | 'friend'
  /** Demande partie, sans réponse. Le bouton est inactif — pas de relance. */
  | 'request-sent'
  /** Demande reçue, en attente : l'écran Amis porte les ✓/✕. */
  | 'request-received'
  | 'none'

/**
 * Une personne, telle que les rangées sociales l'affichent.
 *
 * Trois champs, et pas un de plus. C'est **tout** ce qui sort d'un compte
 * sans relation d'amitié (décision D2.4) : la carte minimale de l'écran 9
 * se rend depuis cet objet, sans second appel réseau — voir `social.md` §2.
 */
export interface SocialPerson {
  readonly pseudo: string
  /** `users.created_at`, ISO. Alimente `membre depuis …`. */
  readonly memberSince: string
  readonly relation: RelationState
}

/** Réponse de `GET /social/search?pseudo=…`. Un pseudo, un compte, ou 404. */
export interface PseudoSearchResponse {
  readonly person: SocialPerson
}

/**
 * Une ligne de `▸ AMIS` (écran 8).
 *
 * `activity` et `compat` sortent des mêmes projections que l'écran 9 —
 * `publicProfile()` et `compatibility()` — jamais d'un second calcul. La
 * rangée montre la dernière ligne d'activité, l'écran 9 en montre vingt :
 * c'est la même liste, tronquée différemment.
 */
export interface FriendSummary extends SocialPerson {
  /** Date d'entrée en amitié, ISO. Ordonne la liste, du plus récent. */
  readonly friendsSince: string
  /** `● regarde …`. `null` quand l'ami n'a encore rien de publiable. */
  readonly activity: FriendActivity | null
  /** `compat N%`. `null` sans recouvrement — l'écran rend `—`, jamais `0 %`. */
  readonly compat: number | null
}

/** La dernière ligne publiable du journal d'un ami. */
export interface FriendActivity {
  readonly ref: string
  readonly type: string
  readonly title: string | null
  readonly at: string | null
}

/** Une demande entrante, telle que `▸ DEMANDES · N` l'affiche. */
export interface IncomingRequest extends SocialPerson {
  readonly requestedAt: string
}

/**
 * Réponse de `GET /social/friends` : tout l'écran 8 en un appel.
 *
 * **Les demandes SORTANTES n'y sont pas.** Le refus est silencieux côté
 * demandeur (`social.md` §1) : une liste « mes demandes en attente » ferait
 * de la disparition d'une ligne une notification de rejet — exactement ce
 * que la décision produit refuse. L'état d'une demande partie se lit sur le
 * bouton de la rangée de recherche, et nulle part ailleurs.
 */
export interface FriendsResponse {
  readonly friends: readonly FriendSummary[]
  readonly incoming: readonly IncomingRequest[]
}

/**
 * Un pseudo en paramètre de route ou de corps.
 *
 * Minuscules forcées ici aussi : le champ protège l'utilisateur, la route
 * protège la donnée. Le format vit dans `PSEUDO_PATTERN`, unique domicile
 * de la règle.
 */
export const pseudoSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => PSEUDO_PATTERN.test(value), { message: 'invalid pseudo' })

/** Corps de `POST /social/requests`. */
export const friendRequestSchema = z.strictObject({ pseudo: pseudoSchema })

export type FriendRequestBody = z.infer<typeof friendRequestSchema>
