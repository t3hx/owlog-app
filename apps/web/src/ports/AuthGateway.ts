import type { AuthUser, OAuthProvider } from '@owlog/contracts'

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
  /**
   * Le fournisseur n'atteste aucune adresse vérifiée. Distinct d'`invalid` :
   * rien n'est faux, il manque une condition — et le message doit dire quoi
   * faire (« vérifie ton e-mail chez GitHub puis réessaie ») plutôt que
   * « recommence ».
   */
  | { readonly kind: 'oauth-unverified-email' }

export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AuthFailure }

/** Ce qu'une rangée de Réglages édite. Au moins un champ. */
export interface ProfilePatch {
  readonly firstName?: string
  readonly pseudo?: string
}

export interface AuthGateway {
  /**
   * Les fournisseurs que le serveur sait honorer.
   *
   * Vide quand aucun secret n'est posé : l'écran ne rend alors aucun bouton
   * et la card se re-centre sur l'e-mail. Un bouton qui mène à une erreur de
   * configuration est pire qu'un bouton absent.
   */
  oauthProviders(): Promise<AuthResult<readonly OAuthProvider[]>>

  /**
   * Ouvre le parcours : rend l'URL vers laquelle naviguer.
   *
   * **Le vérificateur PKCE et l'état anti-CSRF ne traversent pas ce port.**
   * Ils sont créés et gardés par l'adaptateur, parce que les garder est un
   * geste d'infrastructure — du hasard cryptographique et un stockage de
   * session — et parce qu'un écran qui les manipulerait finirait par les
   * journaliser ou les mettre dans une URL.
   */
  oauthBegin(provider: OAuthProvider): Promise<AuthResult<{ readonly url: string }>>

  /**
   * Termine le parcours au retour du fournisseur. Pose la session.
   *
   * `state` est comparé à celui gardé au départ : s'il diffère, la réponse
   * ne vient pas du parcours qu'on a lancé, et rien n'est échangé.
   */
  oauthComplete(
    provider: OAuthProvider,
    params: { readonly code: string; readonly state: string },
  ): Promise<AuthResult<AuthUser>>

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
