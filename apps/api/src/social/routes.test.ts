import {
  SHARED_TOKEN_HEADER,
  type FriendsResponse,
  type PseudoSearchResponse,
  type PushRequest,
  type SerializedEvent,
} from '@owlog/contracts'
import type { PublicProfileView } from '@owlog/domain'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'

import { createScratchDb, type ScratchDb } from '../../test/scratchDb.ts'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { createDb, type Db } from '../db/db.ts'
import { MIGRATIONS_DIR } from '../db/migrate.ts'
import type { MailMessage, Mailer } from '../mail/mailer.ts'
import type { TmdbClient } from '../tmdb.ts'
import { PSEUDO_SEARCH_LIMIT } from './routes.ts'

/**
 * La route de profil, contre une vraie base.
 *
 * Ce qui se prouve ici et nulle part ailleurs : le serveur rejoue bien les
 * réducteurs du domaine sur des lignes de `events`, et la règle « privé =
 * inexistant » ne laisse fuir aucun signal d'existence. Les règles de
 * projection, elles, ont leurs tests dans `packages/domain`.
 */
const adminUrl = inject('databaseAdminUrl')

const CONFIG: Config = {
  port: 0,
  tmdbToken: 'tmdb-test-token',
  sharedToken: 'shared-test-token',
  allowedOrigins: [],
  trustedProxies: ['10.0.0.1'],
  basePath: '',
  databaseUrl: undefined,
  publicOrigin: 'https://owlog.test',
  email: undefined,
}

const IP = '203.0.113.7'
const MOVIE = 'tmdb:movie/603'

function fakeTmdb(): TmdbClient {
  return {
    search: async () => ({ hits: [], count: 0 }),
    detail: async () => {
      throw new Error('not used here')
    },
    season: async () => {
      throw new Error('not used here')
    },
  }
}

interface CaptureMailer extends Mailer {
  readonly sent: MailMessage[]
}

function captureMailer(): CaptureMailer {
  const sent: MailMessage[] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
  }
}

let scratch: ScratchDb
let db: Db

beforeEach(async () => {
  if (!adminUrl) return
  scratch = await createScratchDb(adminUrl)
  db = createDb({ url: scratch.url, migrationsDir: MIGRATIONS_DIR, retryDelayMs: null })
  await db.start()
})

afterEach(async () => {
  if (!adminUrl) return
  await db.stop()
  await scratch.drop()
})

function makeApp(mailer: Mailer = captureMailer()) {
  return createApp({ config: CONFIG, tmdb: fakeTmdb(), db, mailer })
}

type App = ReturnType<typeof makeApp>

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [SHARED_TOKEN_HEADER]: CONFIG.sharedToken,
    'content-type': 'application/json',
    'cf-connecting-ip': IP,
    ...extra,
  }
}

/**
 * Un compte connecté, avec son pseudo posé.
 *
 * `pseudo: null` laisse le compte sans identité sociale — l'état d'un
 * compte sync qui n'a encore fait aucun geste social, et le seul moyen de
 * prouver que les routes l'y renvoient.
 */
async function member(
  email: string,
  pseudo: string | null,
): Promise<{ app: App; cookie: string }> {
  const mailer = captureMailer()
  const app = makeApp(mailer)

  await app.fetch(
    new Request('http://local/auth/request-link', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, language: 'fr' }),
    }),
  )
  const mail = mailer.sent.at(-1)
  if (!mail) throw new Error('no mail captured')
  const code = /\b(\d{6})\b/.exec(mail.subject)?.[1]
  if (!code) throw new Error('no code in mail')

  const verified = await app.fetch(
    new Request('http://local/auth/verify-code', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, code }),
    }),
  )
  const cookie = verified.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('no session cookie')

  const named = await app.fetch(
    new Request('http://local/auth/profile', {
      method: 'POST',
      headers: headers({ cookie }),
      body: JSON.stringify(pseudo === null ? { firstName: 'Alex' } : { firstName: 'Alex', pseudo }),
    }),
  )
  expect(named.status).toBe(200)

  return { app, cookie }
}

let eventCounter = 0

function event(overrides: Partial<SerializedEvent> = {}): SerializedEvent {
  eventCounter += 1
  const suffix = String(eventCounter).padStart(12, '0')
  return {
    id: `01920000-0000-7000-8000-${suffix}`,
    device_id: 'device-a',
    type: 'WATCH',
    media_ref: MOVIE,
    cycle_key: null,
    created_at: '2026-07-30T12:00:00.000Z',
    occurred_at: '2026-07-30T12:00:00.000Z',
    occurred_precision: 'exact',
    ...overrides,
  }
}

async function push(app: App, cookie: string, body: PushRequest) {
  const response = await app.fetch(
    new Request('http://local/sync/events', {
      method: 'POST',
      headers: headers({ cookie }),
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(200)
}

function profile(app: App, cookie: string, pseudo: string) {
  return app.fetch(
    new Request(`http://local/social/profile/${pseudo}`, { headers: headers({ cookie }) }),
  )
}

function search(app: App, cookie: string, pseudo: string) {
  return app.fetch(
    new Request(`http://local/social/search?pseudo=${encodeURIComponent(pseudo)}`, {
      headers: headers({ cookie }),
    }),
  )
}

function ask(app: App, cookie: string, pseudo: string) {
  return app.fetch(
    new Request('http://local/social/requests', {
      method: 'POST',
      headers: headers({ cookie }),
      body: JSON.stringify({ pseudo }),
    }),
  )
}

function answer(app: App, cookie: string, pseudo: string, verdict: 'accept' | 'decline') {
  return app.fetch(
    new Request(`http://local/social/requests/${pseudo}/${verdict}`, {
      method: 'POST',
      headers: headers({ cookie }),
    }),
  )
}

function circle(app: App, cookie: string) {
  return app.fetch(new Request('http://local/social/friends', { headers: headers({ cookie }) }))
}

async function relationOf(app: App, cookie: string, pseudo: string): Promise<string> {
  const response = await search(app, cookie, pseudo)
  expect(response.status).toBe(200)
  return ((await response.json()) as PseudoSearchResponse).person.relation
}

/** Le trio d'événements qui rend un titre « vu » — même chaîne que le client. */
async function markSeen(app: App, cookie: string, ref: string, cycle: string) {
  await push(app, cookie, {
    events: [
      event({ type: 'WATCH', media_ref: ref }),
      event({ type: 'START', media_ref: ref, cycle_key: cycle }),
      event({ type: 'SEEN', media_ref: ref, cycle_key: cycle }),
    ],
    cacheRows: [{ ref, payload: { title: 'Severance', posterPath: '/s.jpg', year: 2022 } }],
  })
}

/** Deux comptes amis, par le chemin nominal : demande puis acceptation. */
async function befriend(
  a: { app: App; cookie: string },
  aPseudo: string,
  b: { app: App; cookie: string },
  bPseudo: string,
) {
  expect((await ask(a.app, a.cookie, bPseudo)).status).toBe(200)
  expect((await answer(b.app, b.cookie, aPseudo, 'accept')).status).toBe(200)
}

describe.skipIf(!adminUrl)('profil — visibilité', () => {
  it('rend son propre profil, sans tuile compat', async () => {
    const { app, cookie } = await member('me@b.c', 'nyx')

    const response = await profile(app, cookie, 'nyx')

    expect(response.status).toBe(200)
    const view = (await response.json()) as PublicProfileView
    expect(view.kind).toBe('own')
    expect(view).not.toHaveProperty('compat')
  })

  it('accepte un pseudo saisi en majuscules dans l URL', async () => {
    const { app, cookie } = await member('me@b.c', 'nyx')

    expect((await profile(app, cookie, 'NYX')).status).toBe(200)
  })

  it('rend 404 pour un compte sans relation, comme pour un pseudo inconnu', async () => {
    // « Privé = inexistant » : les deux réponses doivent être indiscernables,
    // sinon deviner des pseudos suffit à cartographier les comptes.
    await member('other@b.c', 'other')
    const { app, cookie } = await member('me@b.c', 'nyx')

    const stranger = await profile(app, cookie, 'other')
    const unknown = await profile(app, cookie, 'personne')

    expect(stranger.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await stranger.json()).toEqual(await unknown.json())
  })

  it('rend 404 et non 400 sur un pseudo hors format', async () => {
    // Un 400 apprendrait au visiteur à distinguer « mal écrit » d'« inconnu ».
    const { app, cookie } = await member('me@b.c', 'nyx')

    const response = await profile(app, cookie, 'AB')

    expect(response.status).toBe(404)
  })

  it('exige une session', async () => {
    await member('me@b.c', 'nyx')
    const app = makeApp()

    const response = await app.fetch(
      new Request('http://local/social/profile/nyx', { headers: headers() }),
    )

    expect(response.status).toBe(401)
  })
})

describe.skipIf(!adminUrl)('profil — rejeu du domaine côté serveur', () => {
  it('dérive les compteurs des événements poussés, pas d une colonne stockée', async () => {
    const { app, cookie } = await member('me@b.c', 'nyx')

    await push(app, cookie, {
      events: [
        event({ type: 'WATCH' }),
        event({ type: 'START', cycle_key: 'c1' }),
        event({ type: 'SEEN', cycle_key: 'c1' }),
        event({ type: 'FAV' }),
      ],
      cacheRows: [
        { ref: MOVIE, payload: { title: 'Le Parrain', posterPath: '/p.jpg', year: 1972 } },
      ],
    })

    const view = (await (await profile(app, cookie, 'nyx')).json()) as PublicProfileView

    if (view.kind !== 'own') throw new Error('expected own profile')
    expect(view.seenCount).toBe(1)
    expect(view.favoriteCount).toBe(1)
    expect(view.loggedCount).toBe(1)
    expect(view.favorites).toEqual([
      { ref: MOVIE, title: 'Le Parrain', posterPath: '/p.jpg', year: 1972 },
    ])
  })

  it('ne laisse pas fuir le texte d une note par la route', async () => {
    // Le filet de bout en bout : la projection le garantit, cette route le
    // vérifie sur le vrai chemin — base, sérialisation, réponse HTTP.
    const secret = 'NOTE-PRIVEE-QUI-NE-DOIT-PAS-SORTIR'
    const { app, cookie } = await member('me@b.c', 'nyx')

    await push(app, cookie, {
      events: [
        event({ type: 'WATCH' }),
        event({ type: 'START', cycle_key: 'c1' }),
        event({ type: 'NOTE', cycle_key: 'c1', payload: { text: secret } }),
      ],
      cacheRows: [],
    })

    const response = await profile(app, cookie, 'nyx')

    expect(await response.text()).not.toContain(secret)
  })

  it('survit a une ligne de cache que le serveur ne sait pas lire', async () => {
    // `media_cache.payload` est du jsonb opaque, écrit par des versions
    // successives du client : la route doit rendre `null`, pas planter.
    const { app, cookie } = await member('me@b.c', 'nyx')

    await push(app, cookie, {
      events: [event({ type: 'WATCH' }), event({ type: 'FAV' })],
      cacheRows: [{ ref: MOVIE, payload: { title: 42, posterPath: [], year: 'mille' } }],
    })

    const view = (await (await profile(app, cookie, 'nyx')).json()) as PublicProfileView

    if (view.kind !== 'own') throw new Error('expected own profile')
    expect(view.favorites).toEqual([{ ref: MOVIE, title: null, posterPath: null, year: null }])
  })
})

describe.skipIf(!adminUrl)('recherche par pseudo', () => {
  it('rend le pseudo, la date d inscription et la relation', async () => {
    await member('other@b.c', 'other')
    const me = await member('me@b.c', 'nyx')

    const response = await search(me.app, me.cookie, 'other')

    expect(response.status).toBe(200)
    const { person } = (await response.json()) as PseudoSearchResponse
    expect(person.pseudo).toBe('other')
    expect(person.relation).toBe('none')
    expect(Number.isNaN(Date.parse(person.memberSince))).toBe(false)
  })

  it('ne rend rien d autre qu un pseudo, une date et une relation', async () => {
    // C'est la seule surface qui parle d'un compte sans relation : tout
    // champ de plus serait visible sans amitié, contre la décision D2.4.
    await member('other@b.c', 'other')
    const me = await member('me@b.c', 'nyx')

    const { person } = (await (await search(me.app, me.cookie, 'other')).json()) as {
      person: Record<string, unknown>
    }

    expect(Object.keys(person).sort()).toEqual(['memberSince', 'pseudo', 'relation'])
  })

  it('rend la meme 404 sur un pseudo inconnu et sur un pseudo hors format', async () => {
    const me = await member('me@b.c', 'nyx')

    const unknown = await search(me.app, me.cookie, 'personne')
    const malformed = await search(me.app, me.cookie, 'AB')

    expect(unknown.status).toBe(404)
    expect(malformed.status).toBe(404)
    expect(await unknown.json()).toEqual(await malformed.json())
  })

  it('se reconnait soi-meme', async () => {
    const me = await member('me@b.c', 'nyx')

    expect(await relationOf(me.app, me.cookie, 'nyx')).toBe('self')
  })

  it('renvoie a Reglages le compte qui n a pas encore de pseudo', async () => {
    // Un geste social sans identité sociale n'est pas une erreur de saisie :
    // c'est une étape manquante, et l'écran doit savoir où conduire.
    await member('other@b.c', 'other')
    const me = await member('me@b.c', null)

    const response = await search(me.app, me.cookie, 'other')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'pseudo-required' })
  })

  it('coupe l enumeration au-dela de la limite, et le compteur survit au redemarrage', async () => {
    await member('other@b.c', 'other')
    const me = await member('me@b.c', 'nyx')

    for (let index = 0; index < PSEUDO_SEARCH_LIMIT; index += 1) {
      expect((await search(me.app, me.cookie, `ghost${index}`)).status).toBe(404)
    }

    const blocked = await search(me.app, me.cookie, 'other')

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()

    // Le compteur vit en base, pas en mémoire : un redéploiement ne rend
    // pas sa fenêtre à qui balayait l'annuaire.
    const restarted = makeApp()
    expect((await search(restarted, me.cookie, 'other')).status).toBe(429)
  })
})

describe.skipIf(!adminUrl)('demandes d amitié', () => {
  it('part chez le demandeur et arrive chez la cible', async () => {
    const target = await member('other@b.c', 'other')
    const me = await member('me@b.c', 'nyx')

    const sent = await ask(me.app, me.cookie, 'other')

    expect(sent.status).toBe(200)
    expect(await sent.json()).toEqual({ relation: 'request-sent' })
    expect(await relationOf(me.app, me.cookie, 'other')).toBe('request-sent')
    expect(await relationOf(target.app, target.cookie, 'nyx')).toBe('request-received')
  })

  it('est idempotente : redemander ne cree pas une seconde demande', async () => {
    const target = await member('other@b.c', 'other')
    const me = await member('me@b.c', 'nyx')

    await ask(me.app, me.cookie, 'other')
    const again = await ask(me.app, me.cookie, 'other')

    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ relation: 'request-sent' })
    const list = (await (await circle(target.app, target.cookie)).json()) as FriendsResponse
    expect(list.incoming).toHaveLength(1)
  })

  it('refuse la demande a soi-meme', async () => {
    const me = await member('me@b.c', 'nyx')

    const response = await ask(me.app, me.cookie, 'nyx')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'bad-request' })
  })

  it('rend 404 sur un pseudo inconnu, comme la recherche', async () => {
    const me = await member('me@b.c', 'nyx')

    expect((await ask(me.app, me.cookie, 'personne')).status).toBe(404)
  })

  it('scelle l amitie quand les deux demandes se croisent', async () => {
    // A→B puis B→A : les deux ont demandé, il ne reste rien à décider. Une
    // seconde demande en sens inverse serait un statu quo absurde — chacun
    // attendrait la réponse que l'autre a déjà donnée en demandant.
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')

    await ask(a.app, a.cookie, 'beta')
    const crossed = await ask(b.app, b.cookie, 'alpha')

    expect(await crossed.json()).toEqual({ relation: 'friend' })
    expect(await relationOf(a.app, a.cookie, 'beta')).toBe('friend')
    const list = (await (await circle(b.app, b.cookie)).json()) as FriendsResponse
    expect(list.incoming).toHaveLength(0)
    expect(list.friends.map((friend) => friend.pseudo)).toEqual(['alpha'])
  })

  it('accepte : les deux comptes deviennent amis et la demande quitte la liste', async () => {
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')

    await ask(a.app, a.cookie, 'beta')
    const accepted = await answer(b.app, b.cookie, 'alpha', 'accept')

    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ relation: 'friend' })
    expect(await relationOf(a.app, a.cookie, 'beta')).toBe('friend')
    const list = (await (await circle(b.app, b.cookie)).json()) as FriendsResponse
    expect(list.incoming).toHaveLength(0)
    expect(list.friends).toHaveLength(1)
  })

  it('survit a deux acceptations simultanees', async () => {
    // Deux onglets, deux taps sur le même ✓. Sans sérialisation du couple,
    // les deux transactions inséreraient la même amitié.
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')
    await ask(a.app, a.cookie, 'beta')

    const [first, second] = await Promise.all([
      answer(b.app, b.cookie, 'alpha', 'accept'),
      answer(b.app, b.cookie, 'alpha', 'accept'),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const list = (await (await circle(b.app, b.cookie)).json()) as FriendsResponse
    expect(list.friends).toHaveLength(1)
  })

  it('refuse en silence : rien ne distingue le refus d une absence de reponse', async () => {
    // Le refusé ne reçoit rien (social.md §1). Sa relation redevient
    // exactement celle d'avant sa demande — y compris le droit de
    // redemander : la lui retirer lui apprendrait qu'on l'a refusé.
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')
    await ask(a.app, a.cookie, 'beta')

    expect((await answer(b.app, b.cookie, 'alpha', 'decline')).status).toBe(200)

    expect(await relationOf(a.app, a.cookie, 'beta')).toBe('none')
    const list = (await (await circle(b.app, b.cookie)).json()) as FriendsResponse
    expect(list.incoming).toHaveLength(0)
    expect(list.friends).toHaveLength(0)
    const again = await ask(a.app, a.cookie, 'beta')
    expect(await again.json()).toEqual({ relation: 'request-sent' })
  })

  it('rend 404 quand il n y a aucune demande a trancher', async () => {
    const a = await member('a@b.c', 'alpha')
    await member('b@b.c', 'beta')

    expect((await answer(a.app, a.cookie, 'beta', 'accept')).status).toBe(404)
  })
})

describe.skipIf(!adminUrl)('liste des amis', () => {
  it('rend l activite et la compat de chaque ami', async () => {
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')
    await markSeen(a.app, a.cookie, MOVIE, 'cycle-a')
    await markSeen(b.app, b.cookie, MOVIE, 'cycle-b')
    await befriend(a, 'alpha', b, 'beta')

    const list = (await (await circle(a.app, a.cookie)).json()) as FriendsResponse

    expect(list.friends).toHaveLength(1)
    const friend = list.friends[0]!
    expect(friend.pseudo).toBe('beta')
    expect(friend.relation).toBe('friend')
    // Un seul titre, vu des deux côtés : Jaccard vaut 1.
    expect(friend.compat).toBe(100)
    expect(friend.activity?.ref).toBe(MOVIE)
    expect(friend.activity?.title).toBe('Severance')
  })

  it('ne fabrique ni activite ni compat pour un ami tout neuf', async () => {
    // Les zéros sont des données ; une compat de 0 % serait un mensonge.
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')
    await befriend(a, 'alpha', b, 'beta')

    const list = (await (await circle(a.app, a.cookie)).json()) as FriendsResponse

    expect(list.friends[0]?.activity).toBeNull()
    expect(list.friends[0]?.compat).toBeNull()
  })

  it('ne publie pas les demandes sortantes', async () => {
    // Une liste « mes demandes en attente » ferait de la disparition d'une
    // ligne une notification de rejet — ce que la décision produit refuse.
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')
    await ask(a.app, a.cookie, 'beta')

    const mine = (await (await circle(a.app, a.cookie)).json()) as FriendsResponse
    const theirs = (await (await circle(b.app, b.cookie)).json()) as FriendsResponse

    expect(mine.incoming).toHaveLength(0)
    expect(mine.friends).toHaveLength(0)
    expect(theirs.incoming.map((request) => request.pseudo)).toEqual(['alpha'])
  })

  it('exige une session', async () => {
    const app = makeApp()

    expect((await circle(app, 'owlog_session=absent')).status).toBe(401)
  })
})

describe.skipIf(!adminUrl)('profil — ce que l amitié ouvre', () => {
  it('rend le profil complet et la compat a un ami', async () => {
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')
    await markSeen(a.app, a.cookie, MOVIE, 'cycle-a')
    await markSeen(b.app, b.cookie, MOVIE, 'cycle-b')
    await befriend(a, 'alpha', b, 'beta')

    const response = await profile(a.app, a.cookie, 'beta')

    expect(response.status).toBe(200)
    const view = (await response.json()) as PublicProfileView
    if (view.kind !== 'friend') throw new Error('expected friend profile')
    expect(view.compat).toBe(100)
    expect(view.seenCount).toBe(1)
  })

  it('reste 404 apres un refus', async () => {
    const a = await member('a@b.c', 'alpha')
    const b = await member('b@b.c', 'beta')
    await ask(a.app, a.cookie, 'beta')
    await answer(b.app, b.cookie, 'alpha', 'decline')

    expect((await profile(a.app, a.cookie, 'beta')).status).toBe(404)
  })
})
