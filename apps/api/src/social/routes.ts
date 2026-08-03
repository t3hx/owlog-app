import { isValidPseudo, type ApiError } from '@owlog/contracts'
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
import type { Pool } from 'pg'

import { sessionUser } from '../auth/routes.ts'
import { toSerializedEvent, type EventRow } from '../db/eventRows.ts'

/**
 * Surfaces sociales.
 *
 * Une seule route au temps 3 lot « identité » : le profil. Les amitiés, les
 * demandes et la recherche par pseudo arrivent avec T3H-62, sur ce même
 * routeur.
 *
 * **C'est la seule surface du service qui rejoue le domaine.** Ailleurs le
 * serveur est un entrepôt de faits qu'il ne lit pas ; ici il doit décider ce
 * qui sort d'un compte, et cette décision ne peut pas vivre à deux endroits.
 * Il exécute donc exactement les réducteurs du client — `@owlog/domain` est
 * consommé en source, sans build.
 *
 * Deux règles non négociables, chacune couverte par un test de route :
 *
 * - **Privé = inexistant.** Un pseudo inconnu et un pseudo sans relation
 *   rendent la même 404. Les distinguer offrirait une sonde d'énumération :
 *   il suffirait de deviner des pseudos pour cartographier les comptes.
 * - **Le serveur n'assemble pas la réponse.** Il choisit un `viewer` et rend
 *   ce que `publicProfile()` produit. Recomposer ici rouvrirait le chemin de
 *   fuite que la projection existe pour fermer.
 */
export interface SocialDeps {
  /** Paresseux : la garde `db` de l'app a déjà statué quand on déréférence. */
  readonly pool: () => Pool
}

interface SocialEnv {
  readonly Variables: { userId: string }
}

export function createSocialRoutes(deps: SocialDeps) {
  const social = new Hono<SocialEnv>()

  social.use('*', async (c, next) => {
    const user = await sessionUser(deps.pool(), c)
    if (!user) return fail(c, 401, 'unauthorized')
    c.set('userId', user.id)
    await next()
  })

  /**
   * Le profil d'un pseudo.
   *
   * Tant que `friendships` n'existe pas (T3H-62), le seul `viewer` que cette
   * route sait produire est `self` — tout le reste tombe en 404. Ce n'est pas
   * une demi-fonctionnalité : c'est exactement la règle de visibilité, avec
   * un ensemble d'amis vide. Le jour où la table arrive, seule la ligne qui
   * calcule `viewer` change ; la projection, elle, connaît déjà ses trois
   * branches et les teste.
   *
   * Un pseudo hors format rend 404 et non 400 : répondre différemment
   * apprendrait au visiteur à distinguer « mal écrit » de « inconnu », ce
   * qui est déjà un demi-oracle.
   */
  social.get('/profile/:pseudo', async (c) => {
    const pool = deps.pool()
    const viewerId = c.get('userId')
    const pseudo = c.req.param('pseudo').toLowerCase()

    if (!isValidPseudo(pseudo)) return fail(c, 404, 'not-found')

    const found = await pool.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at FROM users WHERE pseudo = $1`,
      [pseudo],
    )
    const owner = found.rows[0]
    if (!owner) return fail(c, 404, 'not-found')

    const viewer = relationTo(owner.id, viewerId)
    if (viewer === 'stranger') return fail(c, 404, 'not-found')

    const view = await project(pool, {
      ownerId: owner.id,
      pseudo,
      memberSince: owner.created_at.toISOString() as Timestamp,
      viewer,
    })

    return c.json(view)
  })

  return social
}

/**
 * Ce que le lecteur est pour le propriétaire du profil.
 *
 * `stranger` est aujourd'hui tout le monde sauf soi-même. T3H-62 y branchera
 * la table `friendships` ; c'est la seule ligne de ce fichier qui bougera.
 */
function relationTo(ownerId: string, viewerId: string): ProfileViewer {
  return ownerId === viewerId ? 'self' : 'stranger'
}

interface ProjectionRequest {
  readonly ownerId: string
  readonly pseudo: string
  readonly memberSince: Timestamp
  readonly viewer: ProfileViewer
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
  const events = await pool.query<EventRow>(
    `SELECT server_seq, id, device_id, type, media_ref, cycle_key,
            created_at, occurred_at, occurred_precision, payload
     FROM events WHERE user_id = $1
     ORDER BY server_seq`,
    [request.ownerId],
  )

  const cacheRows = await pool.query<{ ref: string; payload: unknown }>(
    `SELECT ref, payload FROM media_cache WHERE user_id = $1`,
    [request.ownerId],
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

  return publicProfile({
    pseudo: request.pseudo,
    memberSince: request.memberSince,
    viewer: request.viewer,
    states,
    eventsByMedia,
    cache,
  })
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

function fail(c: Context, status: 401 | 404, error: ApiError['error']) {
  return c.json({ error } satisfies ApiError, status)
}
