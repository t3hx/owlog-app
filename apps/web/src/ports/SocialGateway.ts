import type { FriendsResponse, RelationState, SocialPerson } from '@owlog/contracts'
import type { PublicProfileView } from '@owlog/domain'

/**
 * Port des surfaces sociales.
 *
 * Le domaine ne l'utilise pas : une amitié n'est pas un événement de
 * visionnage, et rien de ce qui passe ici n'entre dans le store. C'est de
 * la donnée **serveur**, lue par deux écrans et jamais projetée.
 *
 * Les erreurs sont **rendues, pas levées** — même promesse que
 * `MediaCatalog`. Un réseau absent, un pseudo introuvable ou un compte sans
 * identité sociale sont des états d'écran, pas des incidents.
 */
export interface SocialGateway {
  /**
   * Cherche un pseudo — exact, jamais par préfixe.
   *
   * `notFound` couvre indistinctement l'inconnu et le mal écrit : le
   * serveur refuse de les distinguer, et l'écran affiche le même encart
   * (« aucun compte à ce pseudo »).
   */
  search(pseudo: string): Promise<SocialResult<SocialPerson>>
  /** Envoie une demande. Idempotente : réenvoyer rend le même état. */
  request(pseudo: string): Promise<SocialResult<RelationState>>
  accept(pseudo: string): Promise<SocialResult<RelationState>>
  decline(pseudo: string): Promise<SocialResult<RelationState>>
  /** Amis et demandes reçues : tout l'écran 8 en un appel. */
  circle(): Promise<SocialResult<FriendsResponse>>
  /**
   * Le profil d'un pseudo.
   *
   * `notFound` sur un non-ami est le comportement voulu, pas une panne :
   * privé = inexistant. La carte minimale d'un non-ami se rend depuis la
   * réponse de `search`, jamais d'ici.
   */
  profile(pseudo: string): Promise<SocialResult<PublicProfileView>>
}

export type SocialResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SocialFailure }

/**
 * Ce qui peut mal se passer, du point de vue de l'écran.
 *
 * La granularité est celle des réactions d'interface, pas celle des codes
 * HTTP. Deux cas méritent d'être distingués des autres :
 *
 * - `pseudoRequired` — le compte n'a pas encore d'identité sociale. L'écran
 *   n'affiche pas une erreur : il emmène à la rangée `pseudo` de Réglages.
 *   C'est une étape manquante, pas une panne.
 * - `signedOut` — aucune session. L'onglet Amis n'est jamais mort : il
 *   explique que le social demande un compte.
 */
export type SocialFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'signedOut' }
  | { readonly kind: 'pseudoRequired' }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'rateLimited'; readonly retryAfter: number }
  | { readonly kind: 'unavailable' }
