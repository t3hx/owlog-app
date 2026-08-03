import { describe, expect, it } from 'vitest'

import { mediaState, type MediaStateRow } from './mediaState.ts'
import {
  publicProfile,
  type ProfileMedia,
  type PublicProfileInput,
  type ProfileViewer,
} from './publicProfile.ts'
import { createFactory } from '../test/factory.ts'
import type { MediaRef, StoredEvent, Timestamp } from '../types.ts'

const A: MediaRef = 'tmdb:movie/1'
const B: MediaRef = 'tmdb:movie/2'
const C: MediaRef = 'tmdb:movie/3'

const MEMBER_SINCE = '2025-03-04T10:00:00.000Z' as Timestamp

const FILM: ProfileMedia = { title: 'Dune', posterPath: '/dune.jpg', year: 2021 }

/** Le texte qui ne doit jamais sortir, quel que soit le chemin. */
const PRIVATE_NOTE = 'SECRET-QUI-NE-DOIT-JAMAIS-SORTIR'

interface Entry {
  readonly ref: MediaRef
  readonly events: readonly StoredEvent[]
  readonly media?: ProfileMedia
}

function build(
  entries: readonly Entry[],
  viewer: ProfileViewer,
  viewerStates?: readonly MediaStateRow[],
) {
  const eventsByMedia = new Map<MediaRef, readonly StoredEvent[]>()
  const cache = new Map<MediaRef, ProfileMedia>()
  const states: MediaStateRow[] = []

  for (const entry of entries) {
    eventsByMedia.set(entry.ref, entry.events)
    if (entry.media) cache.set(entry.ref, entry.media)
    states.push(mediaState(entry.events, entry.ref))
  }

  const input: PublicProfileInput = {
    pseudo: 'nyx',
    memberSince: MEMBER_SINCE,
    viewer,
    states,
    eventsByMedia,
    cache,
    ...(viewerStates === undefined ? {} : { viewerStates }),
  }

  return publicProfile(input)
}

/** Une bibliothèque de titres vus, pour la compat du lecteur. */
function seenLibrary(...refs: readonly MediaRef[]): readonly MediaStateRow[] {
  return refs.map((ref) => {
    const f = createFactory(ref)
    return mediaState([f.watch(), f.start('c1'), f.seen('c1')], ref)
  })
}

/** Un flux contenant un exemplaire de chaque type d'événement du domaine. */
function everyEventType(ref: MediaRef): readonly StoredEvent[] {
  const f = createFactory(ref)
  const events: StoredEvent[] = [
    f.watch(),
    f.start('c1'),
    f.prog('c1', 40, { label: 'S01E04' }),
    f.note('c1', PRIVATE_NOTE),
    f.rate('c1', 5),
    f.seen('c1'),
    f.fav(),
    f.rewatch('c2'),
    // La note doit porter sur le cycle COURANT. `MediaStateRow.comment` ne
    // rend que la note du dernier cycle : posee sur un cycle clos, elle
    // n aurait jamais atteint la ligne d etat, et la sentinelle serait
    // restee verte meme en publiant cette ligne telle quelle.
    f.note('c2', PRIVATE_NOTE),
    f.drop('c2'),
    f.unfav(),
    // Re-marque le titre en coup de coeur : la section des affiches doit
    // etre non vide, sans quoi les tests qui la parcourent sont creux.
    f.fav(),
    f.unknown('FUTURE_TYPE'),
  ]
  const doomed = f.note('c1', `${PRIVATE_NOTE}-ANNULE`)
  events.push(doomed, f.voided(doomed.id))
  return events
}

describe('non-ami', () => {
  it('ne rend que le pseudo et la date d inscription', () => {
    const view = build([{ ref: A, events: everyEventType(A), media: FILM }], 'stranger')

    expect(view).toEqual({ kind: 'minimal', pseudo: 'nyx', memberSince: MEMBER_SINCE })
  })
})

describe('whitelist positive', () => {
  // Le test qui survit a un refactor. Verifier l absence d une cle `note`
  // passerait tout aussi bien le jour ou quelqu un renomme le champ ou
  // l imbrique ailleurs ; chercher la valeur elle-meme dans la sortie
  // serialisee ne se laisse pas contourner.
  it.each<ProfileViewer>(['stranger', 'friend', 'self'])(
    'ne laisse jamais fuir le texte d une note (%s)',
    (viewer) => {
      const view = build([{ ref: A, events: everyEventType(A), media: FILM }], viewer)

      expect(JSON.stringify(view)).not.toContain(PRIVATE_NOTE)
    },
  )

  // La garde qui compte vraiment. La sentinelle ci-dessus ne prouve que
  // « NOTE n est pas publiable » : le texte n atteint jamais la projection,
  // donc elle resterait verte meme si la ligne republiait l evenement brut.
  // Enumerer les cles de CHAQUE ligne, sur un flux qui contient tous les
  // types, echoue des qu un champ non prevu traverse — quel qu il soit.
  it('rend des lignes d activite a quatre cles, jamais l evenement brut', () => {
    const view = build([{ ref: A, events: everyEventType(A), media: FILM }], 'friend')

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.activity.length).toBeGreaterThan(0)
    for (const line of view.activity) {
      expect(Object.keys(line).sort()).toEqual(['at', 'ref', 'title', 'type'])
    }
  })

  it('rend des coups de coeur a quatre cles, jamais la ligne d etat brute', () => {
    // Meme piege du cote des affiches : `MediaStateRow` porte `comment`,
    // c est-a-dire le texte de la derniere NOTE. Un `...row` la publierait.
    const view = build([{ ref: A, events: everyEventType(A), media: FILM }], 'friend')

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.favorites.length).toBeGreaterThan(0)
    for (const favorite of view.favorites) {
      expect(Object.keys(favorite).sort()).toEqual(['posterPath', 'ref', 'title', 'year'])
    }
  })

  it('ne publie pas un type d evenement ecrit par une version ulterieure', () => {
    // Un type inconnu ici peut porter n importe quelle charge utile privee.
    // La whitelist positive le laisse dehors sans qu on ait rien a decider ;
    // une liste d exclusions l aurait publie avec son payload.
    const view = build([{ ref: A, events: everyEventType(A), media: FILM }], 'friend')

    expect(view.kind).toBe('friend')
    if (view.kind !== 'friend') return
    expect(view.activity.map((line) => line.type)).not.toContain('FUTURE_TYPE')
  })

  it('exclut les PROG de l activite, comme le LOG', () => {
    const view = build([{ ref: A, events: everyEventType(A), media: FILM }], 'friend')

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.activity.map((line) => line.type)).not.toContain('PROG')
  })

  it('exclut un evenement annule et son annulation', () => {
    const f = createFactory(A)
    const seen = f.seen('c1')
    const events = [f.watch(), f.start('c1'), seen, f.voided(seen.id)]
    const view = build([{ ref: A, events, media: FILM }], 'friend')

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.activity.map((line) => line.type)).not.toContain('SEEN')
    expect(view.activity.map((line) => line.type)).not.toContain('VOID')
  })
})

describe('profil complet', () => {
  it('compte les vus, les coups de coeur et les titres logges', () => {
    const fa = createFactory(A)
    const fb = createFactory(B)
    const fc = createFactory(C)
    const view = build(
      [
        { ref: A, events: [fa.watch(), fa.start('c1'), fa.seen('c1'), fa.fav()], media: FILM },
        { ref: B, events: [fb.watch(), fb.start('c1'), fb.seen('c1')], media: FILM },
        { ref: C, events: [fc.watch()], media: FILM },
      ],
      'friend',
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.seenCount).toBe(2)
    expect(view.favoriteCount).toBe(1)
    expect(view.loggedCount).toBe(3)
  })

  it('rend les coups de coeur avec leur affiche', () => {
    const fa = createFactory(A)
    const view = build(
      [{ ref: A, events: [fa.watch(), fa.fav()], media: FILM }],
      'friend',
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.favorites).toEqual([
      { ref: A, title: 'Dune', posterPath: '/dune.jpg', year: 2021 },
    ])
  })

  it('ordonne l activite du plus recent au plus ancien', () => {
    const f = createFactory(A)
    const view = build(
      [
        {
          ref: A,
          events: [
            f.watch('2026-01-01T00:00:00.000Z' as Timestamp),
            f.start('c1', '2026-03-01T00:00:00.000Z' as Timestamp),
            f.seen('c1', '2026-02-01T00:00:00.000Z' as Timestamp),
          ],
          media: FILM,
        },
      ],
      'friend',
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.activity.map((line) => line.type)).toEqual(['START', 'SEEN', 'WATCH'])
  })

  it('porte le titre et la date de chaque ligne d activite', () => {
    const f = createFactory(A)
    const occurredAt = '2026-02-01T00:00:00.000Z' as Timestamp
    const view = build(
      [{ ref: A, events: [f.watch(occurredAt)], media: FILM }],
      'friend',
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.activity[0]).toEqual({
      ref: A,
      type: 'WATCH',
      title: 'Dune',
      at: occurredAt,
    })
  })
})

describe('compat', () => {
  it('se calcule entre amis a partir des deux bibliotheques', () => {
    const fa = createFactory(A)
    const view = build(
      [{ ref: A, events: [fa.watch(), fa.start('c1'), fa.seen('c1')], media: FILM }],
      'friend',
      seenLibrary(A),
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.compat).toBe(100)
  })

  it('rend null sans recouvrement', () => {
    const fa = createFactory(A)
    const view = build(
      [{ ref: A, events: [fa.watch(), fa.start('c1'), fa.seen('c1')], media: FILM }],
      'friend',
      seenLibrary(B),
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.compat).toBeNull()
  })

  it('rend null quand la bibliotheque du lecteur n est pas fournie', () => {
    const fa = createFactory(A)
    const view = build(
      [{ ref: A, events: [fa.watch(), fa.start('c1'), fa.seen('c1')], media: FILM }],
      'friend',
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.compat).toBeNull()
  })

  it('n existe pas sur son propre profil', () => {
    // La regle « pas de tuile compat sur son propre profil » est une
    // propriete de type, pas une consigne d ecran : la variante `own` ne
    // porte structurellement aucun champ compat.
    const fa = createFactory(A)
    const view = build(
      [{ ref: A, events: [fa.watch(), fa.start('c1'), fa.seen('c1')], media: FILM }],
      'self',
      seenLibrary(A),
    )

    expect(view.kind).toBe('own')
    expect(view).not.toHaveProperty('compat')
  })
})

describe('fiche de cache absente ou malformee', () => {
  it('rend un titre nul plutot que undefined quand la fiche manque', () => {
    const fa = createFactory(A)
    const view = build([{ ref: A, events: [fa.watch(), fa.fav()] }], 'friend')

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.favorites).toEqual([{ ref: A, title: null, posterPath: null, year: null }])
    expect(view.activity[0]?.title).toBeNull()
  })

  it('rejette les champs de mauvais type au lieu de les propager', () => {
    // La fiche vient d une copie locale d une API tierce ; le type statique
    // ne prouve rien sur ce qui a ete ecrit en base il y a six mois.
    const fa = createFactory(A)
    const malformed = { title: 42, posterPath: {}, year: '2021' } as unknown as ProfileMedia
    const view = build(
      [{ ref: A, events: [fa.watch(), fa.fav()], media: malformed }],
      'friend',
    )

    if (view.kind !== 'friend') throw new Error('expected a friend view')
    expect(view.favorites).toEqual([{ ref: A, title: null, posterPath: null, year: null }])
  })
})
