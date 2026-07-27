import { useTranslation } from 'react-i18next'

import type { SearchScope } from '@/ui/hooks/useSearch'

/**
 * Recherche omniprésente.
 *
 * C'est le composant signature du produit : l'objectif déclaré est
 * « ajouter un contenu avec le moins de clics possible », et tout passe par
 * ici.
 *
 * Les onglets « dossier » **fusionnent** avec la barre. La technique vient
 * du prototype et chaque valeur en est relevée, pas approximée : l'onglet
 * actif porte le même fond que la barre, pas de bordure basse, et un
 * `margin-bottom: -1px` qui le fait chevaucher la bordure supérieure de la
 * barre. Sans ce pixel négatif, un liseré traverse l'onglet actif et
 * l'effet dossier tombe.
 *
 * La loupe est dessinée en CSS — un cercle et un trait. Elle ne coûte
 * aucune requête, reste nette à toute densité, et s'affiche en mode avion.
 */
export interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  scope: SearchScope
  onScopeChange: (scope: SearchScope) => void
  /** Change le placeholder : on n'ajoute pas dans une bibliothèque, on y filtre. */
  context: 'add' | 'filter'
}

const SCOPES: readonly { id: SearchScope; labelKey: 'search.scope.all' | 'search.scope.movies' | 'search.scope.series' }[] = [
  { id: 'all', labelKey: 'search.scope.all' },
  { id: 'movie', labelKey: 'search.scope.movies' },
  { id: 'tv', labelKey: 'search.scope.series' },
]

export function SearchBar({
  value,
  onChange,
  scope,
  onScopeChange,
  context,
}: SearchBarProps) {
  const { t } = useTranslation()

  const scopeLabel = t(SCOPES.find((item) => item.id === scope)?.labelKey ?? 'search.scope.all')
  const placeholder =
    context === 'filter'
      ? t('search.placeholderFilter', { scope: scopeLabel })
      : t('search.placeholderAdd', { scope: scopeLabel })

  return (
    <div className="mb-2">
      <div className="flex gap-1.5 px-3">
        {SCOPES.map((item) => {
          const active = item.id === scope
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onScopeChange(item.id)}
              aria-pressed={active}
              className={[
                'min-h-0 min-w-0 self-start rounded-t-tab border border-b-0 px-4 py-2 font-mono text-[11px]',
                // Le -1px est ce qui fait chevaucher l'onglet et la barre.
                active
                  ? 'relative z-20 -mb-px border-border-active bg-surface text-accent'
                  : 'border-border text-muted',
              ].join(' ')}
            >
              {t(item.labelKey)}
            </button>
          )
        })}

        <span
          title={t('search.moreTypesSoon')}
          className="self-start rounded-t-tab border border-b-0 border-dashed border-border-active px-3 py-2 font-mono text-[11px] text-subtle"
        >
          +
        </span>
      </div>

      <div className="relative z-10 flex items-center gap-2.5 rounded-searchbar border border-border-accent bg-surface px-3.5 shadow-search">
        <Magnifier />

        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full flex-1 bg-transparent py-3.5 text-sm text-text outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
        />

        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('search.clear')}
            className="min-h-0 min-w-0 p-2 font-mono text-xs text-subtle"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

/** Loupe dessinée en CSS : un cercle et un manche incliné. */
function Magnifier() {
  return (
    <span
      aria-hidden
      className="relative size-4 flex-none rounded-full border-2 border-accent"
    >
      <span className="absolute -bottom-[5px] -right-[3px] h-[7px] w-0.5 rotate-[-45deg] bg-accent" />
    </span>
  )
}
