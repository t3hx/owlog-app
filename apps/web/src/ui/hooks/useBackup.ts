import { useCallback, useState } from 'react'

import { systemClock } from '@/adapters/browser/clock'
import { format, type ExportTitle } from '@/domain/export/format'
import { parse } from '@/domain/export/parse'
import type { MediaRef, StoredEvent } from '@/domain/types'
import type { EventStore, RestoreReport } from '@/ports/EventStore'
import { partialCacheRow } from '@/ports/MediaCache'
import type { SettingKey, SettingsStore } from '@/ports/SettingsStore'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Export et import du `.log`.
 *
 * C'est le filet de sécurité : IndexedDB peut être évincé, et sur iOS
 * désinstaller la PWA efface son stockage. Tant que ce fichier existe, aucun
 * de ces gestes n'est définitif.
 *
 * Le domaine formate et relit ; ce hook ne fait que l'entourer de ce qui
 * touche au navigateur — la pagination du store, le `Blob`, le
 * téléchargement, la lecture du fichier choisi.
 */

/** Nombre d'événements lus par tour. Le store n'expose pas de vidage complet. */
const PAGE = 500

/**
 * Réglages emportés par la sauvegarde.
 *
 * La liste est explicite plutôt que déduite : `SettingsStore` ne rend pas
 * tout, et une clé ajoutée sans passer ici sortirait silencieusement du
 * filet. Le type ferme l'union, donc l'oubli se voit à la compilation le jour
 * où on renomme une clé — pas le jour d'une restauration.
 *
 * **Ni `deviceId`, ni les curseurs de sync — jamais.** Le `.log` se
 * réimporte sur un autre appareil : une identité importée ferait passer
 * deux installations pour une seule, et un curseur importé ferait sauter
 * des pulls — des événements distants invisibles pour toujours, sans un
 * bruit. La liste est verrouillée par un test.
 */
export const BACKED_UP: readonly SettingKey[] = ['firstName']

export type BackupState =
  | { readonly status: 'idle' }
  | { readonly status: 'exporting' }
  | { readonly status: 'importing' }
  | { readonly status: 'imported'; readonly report: RestoreReport }
  | { readonly status: 'failed'; readonly reason: string }

export function useBackup(onRestored?: () => void) {
  const { events, settings } = usePorts()
  const [state, setState] = useState<BackupState>({ status: 'idle' })

  const exportLog = useCallback(async () => {
    setState({ status: 'exporting' })

    const all = await readAll(events)
    const titles = await readTitles(events)
    const saved = await readSettings(settings)

    download(format(all, titles, systemClock.now(), saved), fileName(systemClock.now()))
    setState({ status: 'idle' })
  }, [events, settings])

  const importLog = useCallback(
    async (file: File) => {
      setState({ status: 'importing' })

      try {
        const parsed = parse(await file.text())
        const report = await events.restore(parsed.events, cacheRows(parsed.titles))

        // Les reglages apres les evenements : si la reinjection echoue, on ne
        // veut pas d'une app qui affiche un prenom au-dessus d'un log vide.
        for (const key of BACKED_UP) {
          const value = parsed.settings.get(key)
          if (value !== undefined) await settings.write(key, value)
        }

        setState({ status: 'imported', report })
        onRestored?.()
      } catch (error) {
        // Le message vient du parseur, en anglais et destiné au développeur.
        // Le montrer tel quel vaut mieux qu'un « une erreur est survenue » :
        // il dit quelle ligne, et c'est ce qui permet de réparer le fichier.
        setState({ status: 'failed', reason: reasonOf(error) })
      }
    },
    [events, settings, onRestored],
  )

  return { state, exportLog, importLog }
}

/**
 * Lit tout le store, page par page.
 *
 * Le port n'expose volontairement aucun vidage complet — une telle méthode
 * obligerait Postgres à tirer la table entière au temps 2. L'export est le
 * seul appelant qui a réellement besoin de tout, et il paie ce que ça coûte
 * en parcourant le curseur.
 */
async function readAll(store: EventStore): Promise<readonly StoredEvent[]> {
  const all: StoredEvent[] = []
  let cursor: string | null = null

  for (;;) {
    const page = await store.eventsSince(cursor, PAGE)
    if (page.length === 0) break

    all.push(...page)
    cursor = page[page.length - 1]?.id ?? null
    if (page.length < PAGE) break
  }

  return all
}

/** Les seuls réglages qui entrent dans le fichier : la liste, rien qu'elle. */
export async function readSettings(
  store: SettingsStore,
): Promise<ReadonlyMap<string, string>> {
  const saved = new Map<string, string>()

  for (const key of BACKED_UP) {
    const value = await store.read(key)
    if (value !== undefined) saved.set(key, value)
  }

  return saved
}

async function readTitles(store: EventStore): Promise<ReadonlyMap<MediaRef, ExportTitle>> {
  const refs = (await store.allMediaStates()).map((row) => row.ref)
  const rows = await store.mediaCache(refs)

  return new Map(rows.map((row) => [row.ref, { title: row.title, year: row.year }]))
}

/**
 * Lignes de cache réamorcées depuis le fichier.
 *
 * Elles sont marquées incomplètes, ce qu'elles sont : le `.log` ne porte ni
 * genres ni durée. L'adaptateur refusera d'écraser une ligne complète avec,
 * et la première ouverture de la fiche complétera le reste.
 */
function cacheRows(titles: ReadonlyMap<MediaRef, ExportTitle>) {
  return [...titles].map(([ref, title]) =>
    partialCacheRow(
      {
        ref,
        kind: ref.startsWith('tmdb:movie/') ? 'movie' : 'tv',
        title: title.title,
        year: title.year,
        posterPath: null,
      },
      systemClock.now(),
    ),
  )
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')

  link.href = url
  link.download = name
  link.click()

  // Sans cette liberation, le blob reste en memoire jusqu'au rechargement de
  // l'onglet. Sur un export de plusieurs milliers d'evenements, repete, ca se
  // voit — et c'est le genre de fuite qu'on n'attribue jamais a un telechargement.
  URL.revokeObjectURL(url)
}

function fileName(now: string): string {
  return `owlog-${now.slice(0, 10)}.log`
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
