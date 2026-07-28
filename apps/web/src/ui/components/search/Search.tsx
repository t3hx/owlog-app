import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BackdateSheet } from '@/ui/components/search/BackdateSheet'
import { PendingQueue } from '@/ui/components/search/PendingQueue'
import { SearchBar } from '@/ui/components/search/SearchBar'
import { SearchResults } from '@/ui/components/search/SearchResults'
import { usePorts } from '@/ui/PortsProvider'
import type { PendingAdd } from '@/ports/PendingAdds'
import { useBackdate } from '@/ui/hooks/useBackdate'
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
export type SearchMode = 'add' | 'log'

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
  // Le mode ne survit pas au rechargement : un mode invisible au reveil est
  // un mode qui fait loguer un souvenir en croyant ajouter une envie.
  const [mode, setMode] = useState<SearchMode>('add')
  const backdate = useBackdate()
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

      {context === 'add' && <ModeSwitch mode={mode} onChange={setMode} />}

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
          mode={mode}
          onLog={backdate.open}
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

      {backdate.target && (
        <BackdateSheet
          hit={backdate.target}
          outcome={backdate.outcome}
          saving={backdate.saving}
          logged={backdate.logged}
          currentYear={currentYear()}
          onSave={(entry) => void backdate.save(entry)}
          onAgain={backdate.again}
          onClose={() => {
            backdate.close()
            // Vider la requete rend la barre a la recherche suivante : c'est
            // le geste qui enchaine les vingt titres d'une session.
            if (backdate.outcome) setQuery('')
          }}
        />
      )}
    </>
  )
}

/** Deux modes de saisie, teintes comme leur resultat : menthe, puis bleu « vu ». */
function ModeSwitch({
  mode,
  onChange,
}: {
  mode: SearchMode
  onChange: (mode: SearchMode) => void
}) {
  const { t } = useTranslation()

  const shape = 'min-h-0 min-w-0 flex-1 rounded-tab border px-2 py-2.5 font-mono text-[10px]'

  return (
    <div className="mt-2.5 flex gap-2 px-3">
      <button
        type="button"
        onClick={() => onChange('add')}
        aria-pressed={mode === 'add'}
        className={`${shape} ${mode === 'add' ? 'border-border-accent bg-accent/8 text-accent' : 'border-border text-subtle'}`}
      >
        {t('backdate.modeAdd')}
      </button>
      <button
        type="button"
        onClick={() => onChange('log')}
        aria-pressed={mode === 'log'}
        className={`${shape} ${mode === 'log' ? 'border-status-seen/45 bg-status-seen/8 text-status-seen' : 'border-border text-subtle'}`}
      >
        {t('backdate.modeLog')}
      </button>
    </div>
  )
}

/**
 * Annee courante.
 *
 * Lue ici et non dans la feuille : `Date` est interdit au domaine, et le
 * garder au point le plus haut laisse un test fournir la sienne.
 */
function currentYear(): number {
  return new Date().getUTCFullYear()
}
