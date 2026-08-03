import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import { filterLibrary, library, type LibraryFilter, type MediaStateRow, type MediaRef } from '@owlog/domain'
import { FilterChips } from '@/ui/components/library/FilterChips'
import { LibraryRow } from '@/ui/components/library/LibraryRow'
import { LibraryTable } from '@/ui/components/library/LibraryTable'
import { StatusMenu } from '@/ui/components/library/StatusMenu'
import { Search } from '@/ui/components/search/Search'
import { useDesktop } from '@/ui/hooks/useDesktop'
import { useStatusActions } from '@/ui/hooks/useStatusActions'
import { usePorts } from '@/ui/PortsProvider'
import { placeholderCacheRow, type MediaCacheRow } from '@/ports/MediaCache'

/**
 * Bibliothèque.
 *
 * Titre et compteur, six chips de filtre, rangées média. Recréation du
 * prototype `Owlog Prototype.dc.html`.
 *
 * **Le filtre et les compteurs sortent du même prédicat du domaine.** Une
 * chip qui annonce trois titres au-dessus d'une liste qui en montre deux ne
 * se lit pas comme un défaut d'affichage : elle se lit comme une perte de
 * données, et ce projet a déjà passé une session à diagnostiquer ce
 * faux symptôme.
 *
 * La recherche est montée en contexte `filter` : y taper fait apparaître ce
 * qui est déjà en bibliothèque en premier, puis les résultats de l'API. Le
 * badge « N titres à confirmer » vient de la même recherche, qui porte la
 * file d'ajouts hors-ligne.
 */
export function Library() {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const { live } = usePorts()
  const actions = useStatusActions()
  const desktop = useDesktop()

  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [menu, setMenu] = useState<MediaStateRow | null>(null)

  const states = live.useMediaStates()
  const cache = live.useMediaCacheRows()
  const { counts } = library(states)

  const byRef = new Map(cache.map((row) => [row.ref, row]))
  const cacheFor = (ref: MediaRef): MediaCacheRow =>
    byRef.get(ref) ?? placeholderCacheRow(ref, t('home.uncached'))

  const rows = [...filterLibrary(states, filter)].sort(byRecency)

  const open = (ref: MediaRef) => navigate(`/media/${ref.replace('tmdb:', '')}`)

  return (
    <div className={desktop ? 'flex flex-col gap-1' : 'mx-auto flex max-w-md flex-col gap-1 pt-6'}>
      <Search
        context="filter"
        aside={
          <span className="pb-3 font-mono text-[11px] text-muted">
            {t('library.count', { count: counts.all })} · {t('library.sortRecent')}
          </span>
        }
      >
        <div className={desktop ? undefined : 'px-5 pt-2'}>
          {/* En desktop le titre est porté par la sidebar, qui marque l'onglet
              actif : le répéter en tête de contenu ferait un doublon que le
              mock 10b n'a pas. Il reste lisible aux lecteurs d'écran. */}
          <div className={desktop ? undefined : 'flex items-baseline justify-between'}>
            <h1
              className={
                desktop ? 'sr-only' : 'font-display text-[25px] font-semibold text-text'
              }
            >
              {t('library.title')}
            </h1>
            {!desktop && (
              <span className="font-mono text-[11px] text-muted">
                {t('library.count', { count: counts.all })}
              </span>
            )}
          </div>

          <FilterChips counts={counts} active={filter} onPick={setFilter} />

          {rows.length === 0 ? (
            <div className="flex flex-col items-start gap-2 py-8">
              <p className="font-display text-[15px] font-semibold text-text">
                {t(counts.all === 0 ? 'library.empty' : 'library.emptyFilter')}
              </p>
              <p className="text-sm text-muted">
                {t(counts.all === 0 ? 'library.emptyHint' : 'library.emptyFilterHint')}
              </p>
            </div>
          ) : desktop ? (
            <LibraryTable
              rows={rows}
              cacheFor={cacheFor}
              onOpen={open}
              onCycle={(ref) => void actions.cycle(ref)}
              onMenu={setMenu}
            />
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {rows.map((row) => (
                <LibraryRow
                  key={row.ref}
                  row={row}
                  cache={cacheFor(row.ref)}
                  onOpen={() => open(row.ref)}
                  onCycle={() => void actions.cycle(row.ref)}
                  onMenu={() => setMenu(row)}
                />
              ))}

              <p className="mt-2 text-center font-mono text-[10px] text-subtle">
                {t('library.hint')}
              </p>
            </div>
          )}
        </div>
      </Search>

      {menu && (
        <StatusMenu
          title={cacheFor(menu.ref).title}
          current={menu.status}
          onPick={(target) => {
            void actions.pick(menu.ref, target)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/**
 * Le plus récemment touché en tête.
 *
 * Même ordre que l'accueil, pour la même raison : `updatedAt` est l'ordre
 * dans lequel on s'est occupé des titres, pas celui où on les a ajoutés.
 */
function byRecency(a: MediaStateRow, b: MediaStateRow): number {
  return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
}

