import {
  friendRequestSchema,
  isValidPseudo,
  pseudoSchema,
  type ApiError,
  type FriendSummary,
  type FriendsResponse,
  type IncomingRequest,
  type PseudoSearchResponse,
  type RelationState,
} from '@owlog/contracts'
import {
  mediaState,
  publicProfile,
  type MediaRef,
  type MediaStateRow,
  type ProfileMedia,
  type ProfileViewer,
  type PublicProfileView,
  type StoredEvent,
  type Timestamp,
} from '@owlog/domain'
import { Hono, type Context } from 'hono'
import type { Pool, PoolClient } from 'pg'
import { uuidv7 } from 'uuidv7'

import { sessionUser } from '../auth/routes.ts'
import { toSerializedEvent, type EventRow } from '../db/eventRows.ts'

/**
 * Surfaces sociales : profil, recherche par pseudo, demandes et amitiés.
 *
 * **C'est la seule surface du service qui rejoue le domaine.** Ailleurs le
 * serveur est un entrepôt de faits qu'il ne lit pas ; ici il doit décider ce
 * qui sort d'un compte, et cette décision ne peut pas vivre à deux endroits.
 * Il exécute donc exactement les réducteurs du client — `@owlog/domain` est
 * consommé en source, sans build.
 *
 * Règles non négociables, chacune couverte par un test de route :
 *
 * - **Privé = inexistant.** Un pseudo inconnu et un pseudo sans relation
 *   rendent la même 404 sur le profil. Les distinguer offrirait une sonde
 *   d'énumération : il suffirait de deviner des pseudos pour cartographier
 *   les comptes.
 * - **Le serveur n'assemble pas la réponse du profil.** Il choisit un
 *   `viewer` et rend ce que `publicProfile()` produit. Recomposer ici
 *   rouvrirait le chemin de fuite que la projection existe pour fermer.
 * - **Toute mutation d'un couple passe par son verrou.** Accepter deux fois
 *   la même demande, ou se demander mutuellement en amitié à la même
 *   seconde, sont des courses réelles — deux onglets suffisent. Elles sont
 *   sérialisées par `pg_advisory_xact_lock` sur le couple, motif du push de
 *   `/sync`, et non rattrapées après coup.
 * - **Le refus est silencieux.** Rien dans aucune réponse ne permet au
 *   demandeur de distinguer un refus d'une absence de réponse — y compris
 *   le droit de redemander, qui lui reste ouvert.
 * - **La recherche de pseudo porte un compteur persistant.** C'est le seul
 *   endroit où l'existence d'un compte se confirme ; sans plafond, il
 *   suffirait de dérouler un dictionnaire.
 */
export interface SocialDeps {
  /** Paresseux : la garde `db` de l'app a déjà statué quand on déréférence. */
  readonly pool: () => Pool
}

/** Le lecteur courant : son identifiant interne et son identité sociale. */
interface Viewer {
  readonly id: string
  readonly pseudo: string | null
}

interface SocialEnv {
  readonly Variables: { viewer: Viewer }
}

/**
 * Plafond de recherches de pseudo par compte et par fenêtre.
 *
 * Vingt : très au-dessus de l'usage réel — on cherche un pseudo qu'on
 * connaît déjà, on ne feuillette pas un annuaire — et très en dessous de ce
 * qui rendrait un balayage rentable. Exporté parce que le test qui prouve
 * le plafond doit le lire ici, jamais le recopier.
 */
export const PSEUDO_SEARCH_LIMIT = 20

const PSEUDO_SEARCH_WINDOW = '10 minutes'
const PSEUDO_SEARCH_RETRY_AFTER_SECONDS = 10 * 60

/** Longueur de l'activité d'une rangée d'ami : la dernière ligne, une seule. */
const ROW_ACTIVITY_LIMIT = 1

export function createSocialRoutes(deps: SocialDeps) {
  const social = new Hono<SocialEnv>()

  social.use('*', async (c, next) => {
    const user = await sessionUser(deps.pool(), c)
    if (!user) return fail(c, 401, 'unauthorized')
    c.set('viewer', { id: user.id, pseudo: user.pseudo })
    await next()
  })

  /**
   * Recherche par pseudo — exacte, jamais par préfixe.
   *
   * Une recherche floue serait l'énumération elle-même, offerte : trois
   * lettres rendraient une tranche de l'annuaire. On cherche ici un pseudo
   * reçu de vive voix, pas une personne qu'on ne connaît pas.
   *
   * C'est la SEULE surface qui confirme l'existence d'un compte sans
   * relation, et elle ne rend que trois champs (`social.md` §2) : c'est le
   * prix assumé pour que la carte minimale de l'écran 9 se rende sans
   * second appel réseau.
   */
  social.get('/search', async (c) => {
    const pool = deps.pool()
    const viewer = c.get('viewer')
    if (!viewer.pseudo) return fail(c, 409, 'pseudo-required')

    if (await searchLimitExceeded(pool, viewer.id)) return tooMany(c)

    const parsed = pseudoSchema.safeParse(c.req.query('pseudo') ?? '')
    if (!parsed.success) {
      // Un pseudo hors format rend 404 et non 400 : répondre différemment
      // apprendrait au visiteur à distinguer « mal écrit » d'« inconnu »,
      // ce qui est déjà un demi-oracle.
      await audit(pool, 'pseudo-search', viewer.id, null, 'invalid')
      return fail(c, 404, 'not-found')
    }

    const pseudo = parsed.data
    const owner = await findByPseudo(pool, pseudo)
    await audit(pool, 'pseudo-search', viewer.id, pseudo, owner ? 'hit' : 'miss')
    if (!owner) return fail(c, 404, 'not-found')

    const response: PseudoSearchResponse = {
      person: {
        pseudo,
        memberSince: owner.created_at.toISOString(),
        relation: await relationBetween(pool, viewer.id, owner.id),
      },
    }
    return c.json(response)
  })

  /**
   * L'écran Amis en un appel : les amis et les demandes reçues.
   *
   * Un appel plutôt qu'un par ami : la rangée porte l'activité et la
   * compat, toutes deux dérivées du journal de l'ami, et laisser le client
   * les réclamer une par une multiplierait les allers-retours autant qu'il
   * y a d'amis.
   *
   * Coût connu et assumé : le journal de chaque ami est rejoué en entier à
   * chaque appel — `mediaState` est une fonction de la chaîne complète d'un
   * média, et un cycle tronqué produirait un statut faux. La borne est le
   * nombre d'amis, pas le nombre d'événements ; le jour où un compte issu
   * de l'import TVTime rend ce coût sensible, c'est T3H-70 qui le traite,
   * par un état dérivé persistant — pas par un raccourci de projection ici.
   */
  social.get('/friends', async (c) => {
    const pool = deps.pool()
    const viewer = c.get('viewer')

    const friendRows = await pool.query<{
      id: string
      pseudo: string | null
      created_at: Date
      friends_since: Date
    }>(
      `SELECT u.id, u.pseudo, u.created_at, f.created_at AS friends_since
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = $1 OR f.user_b = $1
       ORDER BY f.created_at DESC`,
      [viewer.id],
    )

    const incoming = await pool.query<{
      pseudo: string | null
      created_at: Date
      requested_at: Date
    }>(
      `SELECT u.pseudo, u.created_at, r.created_at AS requested_at
       FROM friend_requests r
       JOIN users u ON u.id = r.requester_id
       WHERE r.addressee_id = $1 AND r.resolved_at IS NULL
       ORDER BY r.created_at DESC`,
      [viewer.id],
    )

    // La bibliothèque du lecteur, lue une fois pour toutes les compats :
    // elle est le même opérande dans chacune.
    const mine = friendRows.rowCount ? (await replay(pool, viewer.id)).states : []

    const friends: FriendSummary[] = []
    for (const row of friendRows.rows) {
      // Les deux côtés d'une amitié ont nécessairement un pseudo — la
      // demande l'exige de l'un et passe par lui pour l'autre. Le filtre
      // est une ceinture, pas une règle.
      if (!row.pseudo) continue

      const view = await projectFriend(pool, {
        ownerId: row.id,
        pseudo: row.pseudo,
        memberSince: row.created_at.toISOString() as Timestamp,
        viewerStates: mine,
      })

      friends.push({
        pseudo: row.pseudo,
        memberSince: row.created_at.toISOString(),
        relation: 'friend',
        friendsSince: row.friends_since.toISOString(),
        activity: view.activity[0] ?? null,
        compat: view.compat,
      })
    }

    const response: FriendsResponse = {
      friends,
      // Même ceinture que pour les amis : demander exige un pseudo, donc
      // un demandeur sans pseudo n'existe pas. `flatMap` filtre et
      // construit d'un geste plutôt que de mentir au typage.
      incoming: incoming.rows.flatMap<IncomingRequest>((row) =>
        row.pseudo === null
          ? []
          : [
              {
                pseudo: row.pseudo,
                memberSince: row.created_at.toISOString(),
                relation: 'request-received',
                requestedAt: row.requested_at.toISOString(),
              },
            ],
      ),
    }
    return c.json(response)
  })

  /**
   * Envoyer une demande.
   *
   * Idempotente : renvoyer la même demande rend le même état plutôt qu'un
   * conflit. L'écran affiche cet état sur le bouton, et une erreur pour un
   * geste sans conséquence obligerait chaque appelant à traiter un cas qui
   * ne veut rien dire.
   *
   * **Demandes croisées : l'amitié est scellée.** Si une demande inverse
   * est pendante, les deux comptes ont demandé — il ne reste rien à
   * décider, et laisser deux demandes se faire face produirait un statu quo
   * absurde où chacun attend la réponse que l'autre a déjà donnée en
   * demandant. Ce cas n'était pas tranché par `social.md` ; il l'est ici.
   */
  social.post('/requests', async (c) => {
    const pool = deps.pool()
    const viewer = c.get('viewer')
    if (!viewer.pseudo) return fail(c, 409, 'pseudo-required')

    const parsed = friendRequestSchema.safeParse(await readJson(c))
    // Un corps illisible et un pseudo inconnu rendent la même 404 : le
    // client n'a rien à apprendre de la différence, et la distinguer
    // rouvrirait l'oracle de format que la route ferme.
    if (!parsed.success) return fail(c, 404, 'not-found')

    const target = await findByPseudo(pool, parsed.data.pseudo)
    if (!target) return fail(c, 404, 'not-found')

    // Se demander soi-même en ami est un défaut du client — la recherche
    // rend déjà `self` sur son propre pseudo, et l'écran n'y offre pas le
    // bouton. Aucun secret ne fuit à le dire : c'est 400, pas 404.
    if (target.id === viewer.id) return fail(c, 400, 'bad-request')

    const relation = await withCoupleLock(pool, viewer.id, target.id, async (client) => {
      if (await areFriends(client, viewer.id, target.id)) return 'friend' as const

      const crossed = await client.query(
        `UPDATE friend_requests SET resolved_at = now(), resolution = 'accepted'
         WHERE requester_id = $1 AND addressee_id = $2 AND resolved_at IS NULL
         RETURNING id`,
        [target.id, viewer.id],
      )

      if (crossed.rowCount) {
        await insertFriendship(client, viewer.id, target.id)
        return 'friend' as const
      }

      // `ON CONFLICT` sur l'index PARTIEL : sa clause `WHERE` doit être
      // répétée ici pour que Postgres sache de quel index on parle. Le
      // verrou du couple rend déjà la course impossible ; ceci en est la
      // ceinture, au cas où un futur appelant l'oublierait.
      await client.query(
        `INSERT INTO friend_requests (id, requester_id, addressee_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (requester_id, addressee_id) WHERE resolved_at IS NULL DO NOTHING`,
        [uuidv7(), viewer.id, target.id],
      )
      return 'request-sent' as const
    })

    return c.json({ relation } satisfies RelationResponse)
  })

  /**
   * Accepter une demande reçue.
   *
   * Deux acceptations simultanées du même ✓ — deux onglets, ou un double
   * tap — donnent toutes deux 200 et une seule amitié : la résolution est
   * un `UPDATE` conditionnel (motif du lien magique), et le perdant
   * constate l'amitié déjà scellée au lieu de rendre une 404 mensongère.
   */
  social.post('/requests/:pseudo/accept', async (c) => {
    const pool = deps.pool()
    const viewer = c.get('viewer')
    const requester = await requesterOf(pool, c.req.param('pseudo'))
    if (!requester) return fail(c, 404, 'not-found')

    const settled = await withCoupleLock(pool, viewer.id, requester.id, async (client) => {
      const resolved = await client.query(
        `UPDATE friend_requests SET resolved_at = now(), resolution = 'accepted'
         WHERE requester_id = $1 AND addressee_id = $2 AND resolved_at IS NULL
         RETURNING id`,
        [requester.id, viewer.id],
      )

      if (!resolved.rowCount) return areFriends(client, viewer.id, requester.id)

      await insertFriendship(client, viewer.id, requester.id)
      return true
    })

    if (!settled) return fail(c, 404, 'not-found')
    return c.json({ relation: 'friend' } satisfies RelationResponse)
  })

  /**
   * Refuser une demande reçue.
   *
   * Rien n'est envoyé au demandeur, et sa relation redevient exactement
   * celle d'avant sa demande — droit de redemander compris. Lui fermer la
   * porte lui apprendrait le refus par l'échec ; le silence ne tient que si
   * l'état d'après est indiscernable de l'état d'avant.
   */
  social.post('/requests/:pseudo/decline', async (c) => {
    const pool = deps.pool()
    const viewer = c.get('viewer')
    const requester = await requesterOf(pool, c.req.param('pseudo'))
    if (!requester) return fail(c, 404, 'not-found')

    const declined = await withCoupleLock(pool, viewer.id, requester.id, (client) =>
      client.query(
        `UPDATE friend_requests SET resolved_at = now(), resolution = 'declined'
         WHERE requester_id = $1 AND addressee_id = $2 AND resolved_at IS NULL
         RETURNING id`,
        [requester.id, viewer.id],
      ),
    )

    if (!declined.rowCount) return fail(c, 404, 'not-found')
    return c.json({ relation: 'none' } satisfies RelationResponse)
  })

  /**
   * Le profil d'un pseudo.
   *
   * Un pseudo hors format rend 404 et non 400 : répondre différemment
   * apprendrait au visiteur à distinguer « mal écrit » de « inconnu », ce
   * qui est déjà un demi-oracle.
   */
  social.get('/profile/:pseudo', async (c) => {
    const pool = deps.pool()
    const viewer = c.get('viewer')
    const pseudo = c.req.param('pseudo').toLowerCase()

    if (!isValidPseudo(pseudo)) return fail(c, 404, 'not-found')

    const owner = await findByPseudo(pool, pseudo)
    if (!owner) return fail(c, 404, 'not-found')

    const seen = visibilityOf(await relationBetween(pool, viewer.id, owner.id))
    if (seen === 'stranger') return fail(c, 404, 'not-found')

    const view = await project(pool, {
      ownerId: owner.id,
      pseudo,
      memberSince: owner.created_at.toISOString() as Timestamp,
      viewer: seen,
      // La compat n'existe qu'entre amis : sur son propre profil, la
      // bibliothèque du lecteur ne sert à rien et n'est pas lue.
      ...(seen === 'friend' ? { viewerStates: (await replay(pool, viewer.id)).states } : {}),
    })

    return c.json(view)
  })

  return social
}

/** Ce que rendent les trois routes de mutation : l'état d'après, rien d'autre. */
interface RelationResponse {
  readonly relation: RelationState
}

interface UserRef {
  readonly id: string
  readonly created_at: Date
}

/** Le compte d'un pseudo, ou rien. Unique lecture de l'annuaire. */
async function findByPseudo(pool: Pool, pseudo: string): Promise<UserRef | undefined> {
  const found = await pool.query<UserRef>(`SELECT id, created_at FROM users WHERE pseudo = $1`, [
    pseudo,
  ])
  return found.rows[0]
}

/** Le demandeur nommé dans l'URL d'un ✓ ou d'un ✕. */
async function requesterOf(pool: Pool, raw: string): Promise<UserRef | undefined> {
  const pseudo = raw.toLowerCase()
  if (!isValidPseudo(pseudo)) return undefined
  return findByPseudo(pool, pseudo)
}

/**
 * Ce que deux comptes sont l'un pour l'autre.
 *
 * **Une seule requête, et l'ordre des tests est la règle produit.** Amis
 * d'abord : une amitié scellée périme toute demande qui traînerait, et lire
 * « demande envoyée » chez un ami afficherait un état mort comme vivant.
 */
async function relationBetween(
  pool: Pool,
  viewerId: string,
  otherId: string,
): Promise<RelationState> {
  if (viewerId === otherId) return 'self'

  const [low, high] = couple(viewerId, otherId)
  const row = (
    await pool.query<{ friend: boolean | null; sent: boolean | null; received: boolean | null }>(
      `SELECT
         (SELECT true FROM friendships WHERE user_a = $1 AND user_b = $2) AS friend,
         (SELECT true FROM friend_requests
           WHERE requester_id = $3 AND addressee_id = $4 AND resolved_at IS NULL) AS sent,
         (SELECT true FROM friend_requests
           WHERE requester_id = $4 AND addressee_id = $3 AND resolved_at IS NULL) AS received`,
      [low, high, viewerId, otherId],
    )
  ).rows[0]

  if (row?.friend) return 'friend'
  if (row?.sent) return 'request-sent'
  if (row?.received) return 'request-received'
  return 'none'
}

/**
 * De l'état de relation à ce que le domaine appelle un lecteur.
 *
 * Deux vocabulaires, et les garder distincts est délibéré : `RelationState`
 * répond « quel geste est offert », `ProfileViewer` répond « qu'ai-je le
 * droit de voir ». Une demande en cours change le premier, jamais le
 * second — accepter vaut consentement de visibilité, demander ne vaut rien.
 */
function visibilityOf(relation: RelationState): ProfileViewer {
  if (relation === 'self') return 'self'
  if (relation === 'friend') return 'friend'
  return 'stranger'
}

/**
 * Le couple, dans l'ordre normalisé qu'impose `friendships_normalized`.
 *
 * Comparaison de chaînes : les uuid canoniques sont en minuscules et leurs
 * tirets occupent des positions fixes, donc l'ordre lexicographique des
 * textes est celui des octets — le même que celui de Postgres.
 */
function couple(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a]
}

async function areFriends(client: PoolClient, a: string, b: string): Promise<boolean> {
  const [low, high] = couple(a, b)
  const found = await client.query(`SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2`, [
    low,
    high,
  ])
  return found.rowCount === 1
}

async function insertFriendship(client: PoolClient, a: string, b: string): Promise<void> {
  const [low, high] = couple(a, b)
  await client.query(
    `INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [low, high],
  )
}

/**
 * Sérialise toute mutation d'un couple, dans une transaction.
 *
 * Motif du push de `/sync` (`pg_advisory_xact_lock`), appliqué au couple
 * plutôt qu'au compte : ce qui se corrompt ici n'appartient à personne
 * seul. Le verrou se libère au COMMIT comme au ROLLBACK — aucun chemin
 * d'erreur ne peut le laisser tenu.
 *
 * La clé est le couple NORMALISÉ : sans normalisation, A→B et B→A
 * prendraient deux verrous différents et ne s'attendraient pas — ce qui est
 * exactement la course des demandes croisées.
 */
async function withCoupleLock<T>(
  pool: Pool,
  a: string,
  b: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const [low, high] = couple(a, b)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [`${low}:${high}`])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Compteur anti-énumération de la recherche de pseudo.
 *
 * **Toutes les tentatives comptent, y compris les échecs** — et c'est
 * l'inverse de `request-link`, où seuls les envois réussis comptent. Le
 * raisonnement s'inverse parce que la clé change : là-bas le compteur porte
 * sur l'adresse d'un tiers, et compter les échecs aurait permis de bloquer
 * la connexion de quelqu'un d'autre ; ici il porte sur le compte appelant,
 * qui ne peut verrouiller que lui-même. Or ce sont précisément les échecs
 * qui signent un balayage d'annuaire.
 *
 * Ce que cette route garantit, et ce qu'elle ne garantit pas : un seul
 * chemin de code et un seul corps de réponse pour « inconnu » et « hors
 * format », donc aucun oracle de contenu. Elle ne prétend pas à une
 * égalisation des temps de réponse — ce serait une affirmation invérifiable
 * ici, et un `sleep` la rendrait fausse en plus d'être coûteux.
 */
async function searchLimitExceeded(pool: Pool, actorId: string): Promise<boolean> {
  const counted = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM social_audit
     WHERE kind = 'pseudo-search' AND actor_id = $1
       AND created_at > now() - interval '${PSEUDO_SEARCH_WINDOW}'`,
    [actorId],
  )
  return Number(counted.rows[0]?.n ?? 0) >= PSEUDO_SEARCH_LIMIT
}

/** Trace d'un geste social — et compteur de la recherche. */
async function audit(
  pool: Pool,
  kind: string,
  actorId: string,
  target: string | null,
  result: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO social_audit (id, kind, actor_id, target, result) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), kind, actorId, target, result],
  )
}

interface ProjectionRequest {
  readonly ownerId: string
  readonly pseudo: string
  readonly memberSince: Timestamp
  readonly viewer: ProfileViewer
  /** Bibliothèque du lecteur, pour la compat. Absente : `compat` vaut `null`. */
  readonly viewerStates?: readonly MediaStateRow[]
  readonly activityLimit?: number
  readonly favoritesLimit?: number
}

/**
 * Rejoue le journal du propriétaire et rend la projection.
 *
 * Le journal se lit **en entier**, pas par page : `mediaState` est une
 * fonction de la chaîne complète d'un média, et un cycle tronqué produirait
 * un statut faux. La borne réelle est le nombre de titres d'un compte, pas
 * le nombre d'événements — l'activité, elle, est bornée par la projection.
 */
async function project(pool: Pool, request: ProjectionRequest): Promise<PublicProfileView> {
  const { states, eventsByMedia, cache } = await replay(pool, request.ownerId)

  return publicProfile({
    pseudo: request.pseudo,
    memberSince: request.memberSince,
    viewer: request.viewer,
    states,
    eventsByMedia,
    cache,
    ...(request.viewerStates === undefined ? {} : { viewerStates: request.viewerStates }),
    ...(request.activityLimit === undefined ? {} : { activityLimit: request.activityLimit }),
    ...(request.favoritesLimit === undefined ? {} : { favoritesLimit: request.favoritesLimit }),
  })
}

/**
 * La même projection, réduite à ce qu'une rangée de l'écran Amis montre.
 *
 * Passe par `publicProfile()` et non par une lecture directe des
 * événements : l'activité d'une rangée et celle de l'écran 9 sont la même
 * liste, tronquée différemment. Un second calcul finirait par diverger, et
 * l'écart se lirait comme une donnée fausse, pas comme un défaut de code.
 */
async function projectFriend(
  pool: Pool,
  request: Omit<ProjectionRequest, 'viewer' | 'activityLimit' | 'favoritesLimit'>,
): Promise<Extract<PublicProfileView, { kind: 'friend' }>> {
  const view = await project(pool, {
    ...request,
    viewer: 'friend',
    activityLimit: ROW_ACTIVITY_LIMIT,
    favoritesLimit: 0,
  })

  // La branche est déterminée par `viewer: 'friend'` ; le vérifier tient
  // l'union discriminée honnête plutôt que de la caster.
  if (view.kind !== 'friend') throw new Error('expected a friend projection')
  return view
}

interface Replayed {
  readonly states: readonly MediaStateRow[]
  readonly eventsByMedia: ReadonlyMap<MediaRef, StoredEvent[]>
  readonly cache: ReadonlyMap<MediaRef, ProfileMedia>
}

/**
 * Le journal d'un compte, regroupé par média, prêt pour les réducteurs.
 *
 * Unique lecture du store côté serveur : le profil, la compat du lecteur et
 * les rangées d'amis passent tous par ici. Deux chemins de lecture auraient
 * fini par diverger sur ce qu'ils incluent.
 */
async function replay(pool: Pool, userId: string): Promise<Replayed> {
  const events = await pool.query<EventRow>(
    `SELECT server_seq, id, device_id, type, media_ref, cycle_key,
            created_at, occurred_at, occurred_precision, payload
     FROM events WHERE user_id = $1
     ORDER BY server_seq`,
    [userId],
  )

  const cacheRows = await pool.query<{ ref: string; payload: unknown }>(
    `SELECT ref, payload FROM media_cache WHERE user_id = $1`,
    [userId],
  )

  const eventsByMedia = new Map<MediaRef, StoredEvent[]>()
  for (const row of events.rows) {
    const ref = row.media_ref as MediaRef
    // Le cast traverse la frontière de sérialisation, comme côté client au
    // `restore()` d'un pull : les types marqués du domaine ne survivent pas
    // à JSON, et les valeurs ont déjà été validées à l'écriture.
    const event = toSerializedEvent(row) as unknown as StoredEvent
    const existing = eventsByMedia.get(ref)
    if (existing) existing.push(event)
    else eventsByMedia.set(ref, [event])
  }

  const states: MediaStateRow[] = []
  for (const [ref, list] of eventsByMedia) states.push(mediaState(list, ref))

  const cache = new Map<MediaRef, ProfileMedia>()
  for (const row of cacheRows.rows) cache.set(row.ref as MediaRef, readCachePayload(row.payload))

  return { states, eventsByMedia, cache }
}

/**
 * Lit les trois champs utiles d'une ligne de cache.
 *
 * **Le serveur ne connaît pas la forme de ces lignes** : `media_cache.payload`
 * est du `jsonb` opaque, écrit par des versions successives du client et
 * jamais interprété par le service — jusqu'ici. On extrait donc ce dont le
 * profil a besoin sans rien supposer ; la validation finale des types vit
 * dans la projection, qui dégrade vers `null` tout ce qui n'a pas la bonne
 * forme.
 */
function readCachePayload(payload: unknown): ProfileMedia {
  const row = (payload ?? {}) as Record<string, unknown>
  return {
    title: typeof row.title === 'string' ? row.title : null,
    posterPath: typeof row.posterPath === 'string' ? row.posterPath : null,
    year: typeof row.year === 'number' ? row.year : null,
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function tooMany(c: Context) {
  c.header('Retry-After', String(PSEUDO_SEARCH_RETRY_AFTER_SECONDS))
  return c.json(
    { error: 'rate-limited', retryAfter: PSEUDO_SEARCH_RETRY_AFTER_SECONDS } satisfies ApiError,
    429,
  )
}

function fail(c: Context, status: 400 | 401 | 404 | 409, error: ApiError['error']) {
  return c.json({ error } satisfies ApiError, status)
}
