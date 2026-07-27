import { applyVoids } from '@/domain/reducers/applyVoids'
import { journal } from '@/domain/reducers/journal'
import { cycles } from '@/domain/rules/cycles'
import { estConnu, type EvenementStocke, type MediaRef } from '@/domain/types'

/**
 * Métriques de diagnostic.
 *
 * Les deux premières viennent du plan et servent à répondre à une question
 * précise : le moment fort du produit a-t-il jamais été déclenché ? Si
 * `cyclesAuDelaDuPremier` reste à zéro après deux semaines d'usage, le
 * produit livré n'est qu'une watchlist de plus, et le rétro-datage n'a
 * servi à rien.
 *
 * La troisième existe parce que les réducteurs ignorent silencieusement les
 * types qu'ils ne connaissent pas. Sans ce compteur, « ignorer » voudrait
 * dire « perdre » : c'est le seul endroit où l'on découvre qu'une version
 * du client a déposé des données qu'une autre ne lit pas.
 */
export interface Metriques {
  readonly medias: number
  /** Visionnages au-delà du premier, tous médias confondus. */
  readonly cyclesAuDelaDuPremier: number
  readonly entreesDeJournal: number
  readonly entreesParJour: number
  readonly evenementsInconnus: readonly { type: string; nombre: number }[]
  readonly evenementsAnnules: number
}

export function metriques(
  evenementsParMedia: ReadonlyMap<MediaRef, readonly EvenementStocke[]>,
): Metriques {
  let cyclesAuDelaDuPremier = 0
  let entreesDeJournal = 0
  let evenementsAnnules = 0
  const inconnus = new Map<string, number>()

  let premierInstant: string | null = null
  let dernierInstant: string | null = null

  for (const evenements of evenementsParMedia.values()) {
    const actifs = applyVoids(evenements)
    evenementsAnnules += evenements.length - actifs.length

    const nombreDeCycles = cycles(actifs).length
    if (nombreDeCycles > 1) cyclesAuDelaDuPremier += nombreDeCycles - 1

    entreesDeJournal += journal(evenements).filter((e) => e.genre === 'evenement').length

    for (const evenement of evenements) {
      if (!estConnu(evenement)) {
        inconnus.set(evenement.type, (inconnus.get(evenement.type) ?? 0) + 1)
      }
      if (premierInstant === null || evenement.created_at < premierInstant) {
        premierInstant = evenement.created_at
      }
      if (dernierInstant === null || evenement.created_at > dernierInstant) {
        dernierInstant = evenement.created_at
      }
    }
  }

  return {
    medias: evenementsParMedia.size,
    cyclesAuDelaDuPremier,
    entreesDeJournal,
    entreesParJour: parJour(entreesDeJournal, premierInstant, dernierInstant),
    evenementsInconnus: [...inconnus.entries()].map(([type, nombre]) => ({ type, nombre })),
    evenementsAnnules,
  }
}

/**
 * Entrées par jour d'usage.
 *
 * Le dénominateur est la durée écoulée depuis le premier événement, bornée
 * à un jour minimum. Diviser par une durée plus courte gonflerait la
 * métrique le premier soir et donnerait une impression d'usage soutenu au
 * moment précis où l'on cherche à savoir si l'habitude se prend.
 */
function parJour(
  entrees: number,
  premier: string | null,
  dernier: string | null,
): number {
  if (premier === null || dernier === null || entrees === 0) return 0

  const millisecondes = new Date(dernier).getTime() - new Date(premier).getTime()
  const jours = Math.max(1, millisecondes / 86_400_000)

  return Math.round((entrees / jours) * 10) / 10
}
