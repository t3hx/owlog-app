import { useEffect, useState } from 'react'
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
export function useSearch(query: string, scope: SearchScope): SearchState {
  const { catalog } = usePorts()
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'fr'

  const [state, setState] = useState<SearchState>({ status: 'idle' })

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
  }, [trimmed, catalog, language])

  if (state.status !== 'done') return state

  return {
    status: 'done',
    hits: scope === 'all' ? state.hits : state.hits.filter((hit) => hit.kind === scope),
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
