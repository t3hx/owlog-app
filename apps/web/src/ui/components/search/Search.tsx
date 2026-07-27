import { useState } from 'react'

import { PendingQueue } from '@/ui/components/search/PendingQueue'
import { SearchBar } from '@/ui/components/search/SearchBar'
import { SearchResults } from '@/ui/components/search/SearchResults'
import { usePorts } from '@/ui/PortsProvider'
import type { PendingAdd } from '@/ports/PendingAdds'
import { useSearch, type SearchScope } from '@/ui/hooks/useSearch'

/**
 * Recherche omniprésente, assemblée.
 *
 * Elle porte l'état de la requête et de l'onglet, et rend les résultats
 * **à la place du contenu de l'écran** dès que la requête n'est pas vide —
 * c'est le comportement du handoff, et c'est ce qui la rend omniprésente
 * plutôt que d'être un écran de plus.
 *
 * Le composant est monté par chaque écran qui en a besoin, avec son
 * contexte : on ajoute depuis l'accueil, on filtre depuis la bibliothèque.
 */
export function Search({
  context,
  children,
}: {
  context: 'add' | 'filter'
  /** Contenu de l'écran, masqué pendant une recherche. */
  children: React.ReactNode
}) {
  const { pending } = usePorts()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  // Entrée de la file qu'on est en train de confirmer. La retenir permet de
  // la retirer quand l'ajout aboutit : sans ça, elle resterait après avoir
  // été résolue, et il faudrait l'abandonner à la main.
  const [resolving, setResolving] = useState<PendingAdd | null>(null)
  const state = useSearch(query, scope)

  const searching = query.trim().length > 0

  function changeQuery(next: string) {
    setQuery(next)
    // Effacer la barre abandonne la résolution en cours, sans toucher à la
    // file : l'entrée reste, on y reviendra.
    if (next.trim().length === 0) setResolving(null)
  }

  return (
    <>
      <SearchBar
        value={query}
        onChange={changeQuery}
        scope={scope}
        onScopeChange={setScope}
        context={context}
      />

      <PendingQueue
        onResume={(entry) => {
          setQuery(entry.text)
          setResolving(entry)
        }}
      />

      {searching ? (
        <SearchResults
          state={state}
          scope={scope}
          query={query}
          onSetAside={(text) => {
            void pending.add(text)
            setQuery('')
          }}
          onAdded={() => {
            if (!resolving) return
            void pending.remove(resolving.id)
            setResolving(null)
            setQuery('')
          }}
        />
      ) : (
        children
      )}
    </>
  )
}
