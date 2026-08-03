import { describe, expect, it } from 'vitest'

import { compatibility } from './compatibility.ts'
import { mediaState, type MediaStateRow } from '../reducers/mediaState.ts'
import { createFactory } from '../test/factory.ts'
import type { MediaRef } from '../types.ts'

const A: MediaRef = 'tmdb:movie/1'
const B: MediaRef = 'tmdb:movie/2'
const C: MediaRef = 'tmdb:movie/3'
const D: MediaRef = 'tmdb:movie/4'

/** Une bibliothèque où chaque référence citée est vue et aboutie. */
function seenLibrary(...refs: readonly MediaRef[]): readonly MediaStateRow[] {
  return refs.map((ref) => {
    const f = createFactory(ref)
    return mediaState([f.watch(), f.start('c1'), f.seen('c1')], ref)
  })
}

/** Une bibliothèque où chaque référence citée est ouverte mais pas aboutie. */
function watchingLibrary(...refs: readonly MediaRef[]): readonly MediaStateRow[] {
  return refs.map((ref) => {
    const f = createFactory(ref)
    return mediaState([f.watch(), f.start('c1')], ref)
  })
}

describe('compatibilite entre deux bibliotheques', () => {
  it('rend cent pour deux bibliotheques identiques', () => {
    expect(compatibility(seenLibrary(A, B), seenLibrary(A, B))).toBe(100)
  })

  it('rend l indice de Jaccard sur un recouvrement partiel', () => {
    // A,B contre B,C : une reference commune sur trois distinctes.
    expect(compatibility(seenLibrary(A, B), seenLibrary(B, C))).toBe(33)
  })

  it('arrondit au point de pourcentage', () => {
    // A,B,C contre C,D : une commune sur quatre distinctes, soit 25 %.
    expect(compatibility(seenLibrary(A, B, C), seenLibrary(C, D))).toBe(25)
  })

  it('est symetrique', () => {
    // La compat que je lis chez toi doit etre celle que tu lis chez moi :
    // une mesure de relation qui differe selon le sens de lecture est un
    // defaut visible a deux, et le premier reproche qu on nous ferait.
    const mine = seenLibrary(A, B, C)
    const yours = seenLibrary(C, D)

    expect(compatibility(mine, yours)).toBe(compatibility(yours, mine))
  })
})

describe('absence de recouvrement', () => {
  it('rend null plutot que zero sans aucun titre commun', () => {
    // Un 0 % annoncerait « nous n avons rien en commun » alors que la
    // mesure n a simplement rien a dire. L ecran rend `compat —`.
    expect(compatibility(seenLibrary(A, B), seenLibrary(C, D))).toBeNull()
  })

  it('rend null quand une bibliotheque est vide', () => {
    expect(compatibility(seenLibrary(A, B), [])).toBeNull()
  })

  it('rend null quand les deux bibliotheques sont vides', () => {
    // Le denominateur de Jaccard vaut zero : sans ce cas, la fonction rend
    // NaN, qui traverserait la projection jusqu a l ecran.
    expect(compatibility([], [])).toBeNull()
  })
})

describe('ce qui entre dans la mesure', () => {
  it('ne compte que les titres vus, jamais les titres en cours', () => {
    // Deux personnes qui ont commencé la même série ne partagent pas un
    // visionnage : elles partagent une intention. La tuile s appelle
    // `✓ vus`, et son ensemble est celui de la chip `vu` de la
    // bibliotheque — une seule definition pour les deux.
    expect(compatibility(watchingLibrary(A, B), watchingLibrary(A, B))).toBeNull()
  })

  it('ignore un titre retire de la bibliotheque', () => {
    const f = createFactory(A)
    const removed = [mediaState([f.watch(), f.start('c1'), f.seen('c1'), f.remove()], A)]

    expect(compatibility(removed, seenLibrary(A))).toBeNull()
  })

  it('compte un titre revu une seule fois', () => {
    // Le visionnage est l unite d enregistrement du produit, mais la compat
    // mesure un recouvrement d ensembles : revoir un film trois fois ne
    // rend pas la relation trois fois plus compatible.
    const f = createFactory(A)
    const rewatched = [
      mediaState([f.watch(), f.start('c1'), f.seen('c1'), f.rewatch('c2'), f.seen('c2')], A),
    ]

    expect(compatibility(rewatched, seenLibrary(A))).toBe(100)
  })
})
