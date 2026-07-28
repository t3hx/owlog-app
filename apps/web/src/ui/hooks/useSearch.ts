import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SearchHit } from '@owlog/contracts'
import type { CatalogFailure } from '@/ports/MediaCatalog'
import { usePorts } from '@/ui/PortsProvider'

/** Onglet « dossier » sélectionné. */
export type SearchScope = 'all' | 'movie' | 'tv'

export type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching' }
  | { readonly status: 'done'; readonly hits: readonly SearchHit[] }
  | { readonly status: 'failed'; readonly failure: CatalogFailure }

/** Délai d'anti-rebond, en millisecondes. */
const DEBOUNCE_MS = 300

/**
 * Recherche anti-rebondie.
 *
 * L'anti-rebond ne sert pas le confort : il sert le **quota TMDB**. Une
 * requête par frappe épuiserait la clé en quelques sessions, et elle
 * s'épuise pour tout le monde à la fois puisqu'il n'y en a qu'une.
 *
 * Le filtrage par type se fait **côté client**, sur les résultats déjà
 * reçus. Le proxy fait un seul appel multi-types ; refiltrer ici évite un
 * aller-retour réseau à chaque changement d'onglet, et le compteur affiché
 * reste celui des résultats visibles.
 *
 * La langue courante voyage avec la requête : TMDB renvoie des titres et
 * des synopsis traduits, et basculer FR/EN doit changer ce qu'on lit.
 */
export function useSearch(
  query: string,
  scope: SearchScope,
): { readonly state: SearchState; readonly retry: () => void } {
  const { catalog } = usePorts()
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'fr'

  const [state, setState] = useState<SearchState>({ status: 'idle' })
  /**
   * Numéro de tentative.
   *
   * Il existe pour une raison précise, et elle a coûté une session de
   * diagnostic : sans lui, l'effet ne se relance que si le **texte** change.
   * Une recherche qui échoue hors-ligne reste donc en échec pour ce texte,
   * définitivement — retaper le même titre au retour du réseau ne fait
   * rien, et l'app donne l'impression d'avoir perdu l'API pour de bon.
   */
  const [attempt, setAttempt] = useState(0)

  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length === 0) {
      setState({ status: 'idle' })
      return
    }

    setState({ status: 'searching' })

    let cancelled = false
    const timer = window.setTimeout(async () => {
      const result = await catalog.search(trimmed, toApiLanguage(language))
      if (cancelled) return

      setState(
        result.ok
          ? { status: 'done', hits: result.value.hits }
          : { status: 'failed', failure: result.failure },
      )
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed, catalog, language, attempt])

  const retry = useCallback(() => setAttempt((previous) => previous + 1), [])

  /**
   * Le retour du réseau relance la recherche en échec.
   *
   * C'est le geste que l'utilisateur attend et ne fait pas : il coupe le
   * mode avion et regarde l'écran. Lui demander de modifier son texte pour
   * réamorcer une requête serait une règle que rien n'annonce.
   *
   * Conditionné à un échec en cours : sans ce garde, chaque bascule réseau
   * relancerait une requête même sur un écran au repos, donc consommerait
   * le quota TMDB pour rien.
   */
  useEffect(() => {
    if (state.status !== 'failed') return

    const onOnline = () => retry()
    window.addEventListener('online', onOnline)

    return () => window.removeEventListener('online', onOnline)
  }, [state.status, retry])

  if (state.status !== 'done') return { state, retry }

  return {
    state: {
      status: 'done',
      hits: scope === 'all' ? state.hits : state.hits.filter((hit) => hit.kind === scope),
    },
    retry,
  }
}

/**
 * Traduit une langue d'interface en langue TMDB.
 *
 * TMDB attend une étiquette régionale (`fr-FR`), pas un code de langue nu.
 * Lui passer `fr` renvoie de l'anglais sans le signaler.
 */
function toApiLanguage(language: string): string {
  return language.startsWith('en') ? 'en-US' : 'fr-FR'
}
