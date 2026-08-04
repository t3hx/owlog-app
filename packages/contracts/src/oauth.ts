import { z } from 'zod'

/**
 * Contrat de la connexion par fournisseur tiers (Google, GitHub).
 *
 * **Le flux ne suit pas le motif OAuth habituel, et c'est délibéré**
 * (décision eng F-4.2). Le callback du fournisseur est une navigation
 * top-level : le navigateur y arrive par une redirection, pas par un
 * `fetch`, donc il ne peut porter aucun en-tête — or le middleware
 * `/auth/*` exige le jeton partagé. Faire atterrir le callback sur l'API
 * aurait donc obligé à ouvrir une route sans ce filtre.
 *
 * ```
 *   web  ──▶ /auth/oauth/:provider/start   (fetch, en-tête, PKCE)
 *        ◀── { url }
 *   nav  ──▶ le fournisseur
 *        ◀── redirection vers LE WEB : /login/oauth/:provider?code=&state=
 *   web  ──▶ /auth/oauth/:provider/callback  (fetch même origine, en-tête)
 *        ◀── { user } + cookie de session
 * ```
 *
 * Le web reste donc la seule surface de navigation, et l'API la seule
 * surface d'API — le même partage que le lien magique, dont la page
 * d'atterrissage POSTe elle aussi son jeton.
 */

/**
 * Fournisseurs retenus au gate D1.4 : Google et GitHub.
 *
 * Ni Apple ni Discord, que montrait le prototype : pas de case fantôme.
 * Un fournisseur dont les secrets manquent n'est pas rendu du tout — la
 * card de connexion se re-centre sur l'e-mail (motif du temps 2).
 */
export const OAUTH_PROVIDERS = ['google', 'github'] as const

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Réponse de `GET /auth/oauth/providers` : ceux qui sont **configurés**.
 *
 * La liste est vide tant qu'aucun secret n'est posé, et l'écran n'affiche
 * alors aucun bouton. C'est la dégradation douce du temps 2 appliquée ici :
 * un bouton qui mène à une erreur de configuration est pire qu'un bouton
 * absent — l'utilisateur croit avoir un chemin, et il n'en a pas.
 */
export interface OAuthProvidersResponse {
  readonly providers: readonly OAuthProvider[]
}

/**
 * Réponse de `GET /auth/oauth/:provider/start` : l'URL d'autorisation,
 * construite par le serveur.
 *
 * Le web ne la compose pas lui-même : elle porte l'identifiant client, les
 * scopes et l'URI de redirection — trois valeurs qui appartiennent à la
 * configuration du service, pas à l'écran. Le jour où un scope change, un
 * seul fichier bouge.
 */
export interface OAuthStartResponse {
  readonly url: string
}

/** Paramètres de `GET /auth/oauth/:provider/start`. */
export const oauthStartQuerySchema = z.strictObject({
  /** Défi PKCE, S256 — le seul mode accepté par les deux fournisseurs. */
  challenge: z.string().min(16).max(256),
  /** Anti-CSRF, comparé par le web au retour. */
  state: z.string().min(16).max(256),
})

/**
 * Corps de `POST /auth/oauth/:provider/callback`.
 *
 * Le `verifier` voyage ici et nulle part ailleurs : il n'a jamais quitté
 * l'appareil pendant l'aller, ce qui est tout l'intérêt de PKCE — un code
 * intercepté dans l'URL de redirection ne s'échange contre rien sans lui.
 */
export const oauthCallbackSchema = z.strictObject({
  code: z.string().min(1).max(2048),
  verifier: z.string().min(43).max(128),
})

export type OAuthCallbackBody = z.infer<typeof oauthCallbackSchema>
