import { useTranslation } from 'react-i18next'

import {
  LIBRARY_FILTERS,
  type LibraryFilter,
  type LibraryView,
} from '@/domain/reducers/mediaState'
import { STATUS_CHIP, STATUS_GLYPH } from '@/ui/components/status/statusStyle'

export interface FilterChipsProps {
  counts: LibraryView['counts']
  active: LibraryFilter
  onPick: (filter: LibraryFilter) => void
}

/**
 * Chips de filtre de la bibliothèque.
 *
 * Six chips, comptées par le domaine : `tous · N`, les quatre statuts, et les
 * coups de cœur. **La somme dépasse `tous`, et c'est correct** — le coup de
 * cœur n'est pas un statut, il se cumule avec les quatre.
 *
 * La chip `♥` porte **bordure et texte en dégradé, jamais de fond plein** :
 * c'est la seule exception du handoff à la règle qui réserve le dégradé aux
 * actions. Un fond plein en ferait un bouton d'action, ce qu'elle n'est pas.
 */
export function FilterChips({ counts, active, onPick }: FilterChipsProps) {
  const { t } = useTranslation()

  return (
    <div className="mt-3.5 flex flex-wrap gap-2">
      {LIBRARY_FILTERS.map((filter) => {
        const label = `${labelOf(filter, t)} · ${counts[filter]}`
        const on = filter === active

        if (filter === 'favorites') {
          return (
            <button
              key={filter}
              type="button"
              onClick={() => onPick(filter)}
              aria-pressed={on}
              className={[
                shape,
                'border-gradient',
                // La chip active se distingue par son fond, pas par sa
                // bordure : celle-ci est déjà prise par le dégradé.
                on ? 'bg-surface' : 'bg-bg',
              ].join(' ')}
            >
              <span className="text-gradient-action">{label}</span>
            </button>
          )
        }

        return (
          <button
            key={filter}
            type="button"
            onClick={() => onPick(filter)}
            aria-pressed={on}
            className={[
              shape,
              'border',
              filter === 'all'
                ? on
                  ? 'border-border-active bg-surface text-text'
                  : 'border-border text-muted'
                : on
                  ? STATUS_CHIP[filter].on
                  : STATUS_CHIP[filter].off,
            ].join(' ')}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

const shape =
  'min-h-0 min-w-0 flex-none whitespace-nowrap rounded-full px-3.5 py-[7px] font-mono text-[10.5px]'

function labelOf(
  filter: LibraryFilter,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (filter === 'all') return t('library.filterAll')
  if (filter === 'favorites') return t('library.filterFavorites')

  return `${STATUS_GLYPH[filter]} ${t(`status.${filter}` as 'status.to-watch')}`
}
