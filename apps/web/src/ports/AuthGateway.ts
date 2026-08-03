import type { AuthUser } from '@owlog/contracts'

/**
 * Port de l'authentification, vue client.
 *
 * Même contrat de conduite que les autres passerelles HTTP : les échecs
 * sont des valeurs, jamais des exceptions. Chaque échec correspond à un
 * état précis de l'écran de connexion :
 *
 * - `invalid` — lien ou code refusé (inconnu, expiré, consommé, faux).
 *   Sur un code faux, `attemptsLeft` accompagne : la spec impose de
 *   l'afficher ;
 * - `locked` — cinq codes faux, le jeton est mort : l'écran revient en
 *   phase 1 avec un message ;
 * - `rate-limited` — trop de demandes : le bouton « renvoyer » vit sous
 *   un compte à rebours, jamais un lien muet qui échoue en silence ;
 * - `offline` / `unavailable` — réseau coupé, service ou base indisponible.
 */
export type AuthFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'invalid'; readonly attemptsLeft?: number }
  | { readonly kind: 'locked' }
  | { readonly kind: 'rate-limited'; readonly retryAfter: number }
  | { readonly kind: 'unavailable' }
  /**
   * Pseudo déjà porté par un autre compte. Distinct de `invalid` : ce n'est
   * pas un refus d'authentification mais un conflit d'identité, et l'écran
   * le rend sous le champ plutôt qu'en tête de card.
   */
  | { readonly kind: 'pseudo-taken' }

export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AuthFailure }

/** Ce qu'une rangée de Réglages édite. Au moins un champ. */
export interface ProfilePatch {
  readonly firstName?: string
  readonly pseudo?: string
}

export interface AuthGateway {
  /** Demande l'e-mail de connexion. La réponse ne dit jamais si le compte existe. */
  requestLink(email: string, language: 'fr' | 'en'): Promise<AuthResult<void>>

  /** Vérifie le code à six chiffres. Pose la session en cookie. */
  verifyCode(email: string, code: string): Promise<AuthResult<AuthUser>>

  /**
   * Consomme le jeton du lien magique. C'est un POST déclenché par la page
   * d'atterrissage — JAMAIS le GET de la page : les scanners d'e-mail
   * pré-visitent les liens et brûleraient un jeton à usage unique.
   */
  verifyLink(token: string): Promise<AuthResult<AuthUser>>

  /** La session courante. `null` sans session — ce n'est pas une erreur. */
  me(): Promise<AuthResult<AuthUser | null>>

  /**
   * Écrit le profil serveur — qui fait autorité après connexion.
   *
   * **Un patch, pas un remplacement** : un champ omis reste intact. L'écran
   * Réglages a deux rangées éditables indépendamment, et celle du pseudo ne
   * connaît pas le prénom. Sans cette distinction, chaque rangée devrait
   * renvoyer une valeur qu'elle n'édite pas — et l'écraserait à la première
   * désynchronisation.
   */
  updateProfile(patch: ProfilePatch): Promise<AuthResult<AuthUser>>

  logout(): Promise<AuthResult<void>>
}
