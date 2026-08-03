import { filterLibrary, type MediaStateRow } from '../reducers/mediaState.ts'
import type { MediaRef } from '../types.ts'

/**
 * Compatibilité entre deux bibliothèques, en points de pourcentage.
 *
 * **Indice de Jaccard sur les titres vus** : `|A ∩ B| / |A ∪ B|`, où `A` et
 * `B` sont les ensembles de références abouties de chacun. C'est l'unique
 * domicile de la formule — l'écran Amis, l'écran Profil et la tuile `compat`
 * la lisent tous ici, jamais recalculée ailleurs.
 *
 * Trois décisions qui ne se devinent pas en lisant la signature :
 *
 * - **Symétrique par construction.** La compat lue chez l'autre est celle
 *   qu'il lit chez nous. Une mesure de relation qui dépend du sens de
 *   lecture est un défaut visible à deux.
 * - **Intersection vide rend `null`, jamais `0`.** L'écran affiche `—`. Un
 *   `0 %` affirmerait « nous n'avons rien en commun » là où la mesure n'a
 *   simplement rien à dire — et sur deux bibliothèques vides, la division
 *   rendrait `NaN`, qui traverserait la projection jusqu'à l'affichage.
 * - **Un titre revu ne compte qu'une fois.** Le visionnage est bien l'unité
 *   d'enregistrement du produit, mais la compat mesure un recouvrement
 *   d'ensembles : revoir trois fois ne rend pas la relation trois fois plus
 *   compatible.
 *
 * Le biais assumé de Jaccard : deux bibliothèques de tailles très inégales
 * plafonnent bas même quand la petite est incluse dans la grande. Les
 * variantes qui corrigent ce biais (recouvrement sur `min`) affichent
 * `100 %` dans ce même cas, ce qui ment davantage.
 */
export function compatibility(
  a: readonly MediaStateRow[],
  b: readonly MediaStateRow[],
): number | null {
  const mine = seenRefs(a)
  const theirs = seenRefs(b)

  let shared = 0
  for (const ref of mine) {
    if (theirs.has(ref)) shared += 1
  }

  if (shared === 0) return null

  // Cardinal de l'union par inclusion-exclusion : la construire vraiment
  // allouerait un troisième ensemble pour n'en lire que la taille.
  const union = mine.size + theirs.size - shared

  return Math.round((shared / union) * 100)
}

/**
 * L'ensemble des titres vus d'une bibliothèque.
 *
 * Passe par `filterLibrary(states, 'seen')` et non par un prédicat local :
 * c'est la **même** définition de « vu » que la chip de la bibliothèque et
 * que la tuile `✓ vus` de l'écran de stats. Réécrire `row.status === 'seen'`
 * ici créerait une seconde définition qui divergerait au premier changement
 * de règle — et l'écart se lirait comme une donnée fausse, pas comme un
 * défaut de code.
 */
function seenRefs(states: readonly MediaStateRow[]): ReadonlySet<MediaRef> {
  return new Set(filterLibrary(states, 'seen').map((row) => row.ref))
}
