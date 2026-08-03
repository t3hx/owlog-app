import { EXPORT_VERSION, SEPARATOR, type ExportTitle } from './format.ts'
import type {
  DatePrecision,
  MediaRef,
  StoredEvent,
  Timestamp,
} from '../types.ts'

/**
 * Parseur `.log`.
 *
 * Il ne lit que la queue de chaque ligne — tout ce qui précède la barre est
 * décoratif, tronqué et assaini par le formateur. C'est ce partage qui permet
 * au fichier d'être à la fois lisible et exactement réversible : la mise en
 * page ne porte aucune information, donc elle ne peut rien perdre.
 *
 * **Il refuse plutôt que de restaurer à moitié.** Un import partiel silencieux
 * est le pire résultat possible : l'utilisateur croit sa sauvegarde bonne et
 * découvre le trou des mois plus tard, quand l'original n'existe plus. Un
 * fichier tronqué ou une ligne illisible lèvent, en disant où.
 *
 * Les messages d'erreur sont en anglais : ils s'adressent au développeur, pas
 * à l'utilisateur, et ne passent pas par l'i18n.
 */

export interface ParsedExport {
  readonly events: readonly StoredEvent[]
  /**
   * Titres relus de la colonne lisible.
   *
   * Une restauration se fait souvent sans réseau — c'est même le cas type,
   * puisqu'on restaure après avoir tout perdu. Sans eux, la bibliothèque
   * revient en références nues jusqu'au prochain appel à TMDB.
   */
  readonly titles: ReadonlyMap<MediaRef, ExportTitle>
  /**
   * Réglages relus des commentaires.
   *
   * Sans eux, une restauration rend le journal mais laisse l'app à son écran
   * de première ouverture — qui affirme « ton log est vide » au-dessus d'un
   * log qui ne l'est pas.
   */
  readonly settings: ReadonlyMap<string, string>
}

const HEADER = /^#\s*owlog\s*·\s*export v(\d+)\s*·\s*\S+\s*·\s*(\d+)/u
const SETTING = /^#\s*setting\s+(\S+)\s*=\s*(.+)$/u
const MEDIA_REF = /^tmdb:(movie|tv)\/\d+$/u
const PRECISIONS = new Set<string>(['exact', 'day', 'month', 'year', 'unknown'])

/** Titre lisible : « Matrix (1999) », ou une référence nue si le cache manquait. */
const TITLE_COLUMN = /^(.*?)(?:\s\((\d{4})\))?$/u

export function parse(text: string): ParsedExport {
  const events: StoredEvent[] = []
  const titles = new Map<MediaRef, ExportTitle>()
  const settings = new Map<string, string>()
  let declared: number | null = null

  const lines = text.split('\n')

  for (const [index, raw] of lines.entries()) {
    const number = index + 1
    const line = raw.trimEnd()

    if (line.trim().length === 0) continue

    if (line.startsWith('#')) {
      const header = HEADER.exec(line)
      if (header) {
        checkVersion(Number(header[1]), number)
        declared = Number(header[2])
        continue
      }

      const setting = SETTING.exec(line)
      if (setting?.[1] && setting[2]) {
        settings.set(setting[1], readSettingValue(setting[2], number))
      }
      continue
    }

    const cut = line.indexOf(SEPARATOR)
    if (cut === -1) {
      throw new Error(`Malformed export at line ${number}: missing "${SEPARATOR.trim()}" separator`)
    }

    const event = readEvent(line.slice(cut + SEPARATOR.length), number)
    events.push(event)

    const title = readTitle(line.slice(0, cut))
    if (title && !titles.has(event.media_ref)) titles.set(event.media_ref, title)
  }

  // Le compte de l'en-tete fait foi. Sans cette verification, une copie
  // interrompue produit un fichier parfaitement valide et incomplet.
  if (declared !== null && declared !== events.length) {
    throw new Error(
      `Truncated export: header declares ${declared} event(s), found ${events.length}`,
    )
  }

  // Rendu dans l'ordre des identifiants, et non dans celui du fichier : les
  // `PROG` y sont relegues en fin de document pour la lisibilite, ce qui est
  // une decision de mise en page. La restaurer telle quelle ferait entrer
  // cette decision dans le store, ou elle n'a rien a faire. Les UUIDv7 etant
  // ordonnables par le temps, c'est aussi l'ordre que rend `eventsSince`.
  events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return { events, titles, settings }
}

/** La valeur est encodée en JSON, pour laisser passer espaces et accents. */
function readSettingValue(encoded: string, line: number): string {
  try {
    const value: unknown = JSON.parse(encoded)
    if (typeof value !== 'string') throw new Error('not a string')
    return value
  } catch {
    throw new Error(`Malformed export at line ${line}: setting value is not a JSON string`)
  }
}

function checkVersion(version: number, line: number): void {
  if (version > EXPORT_VERSION) {
    throw new Error(
      `Unsupported export version ${version} at line ${line}: this client reads up to v${EXPORT_VERSION}`,
    )
  }
}

/**
 * Relit un événement depuis la queue.
 *
 * Six champs positionnels, puis des paires nommées. `payload=` prend tout le
 * reste de la ligne, ce qui laisse un commentaire d'utilisateur contenir des
 * espaces et des guillemets sans convention d'échappement supplémentaire.
 */
function readEvent(tail: string, line: number): StoredEvent {
  const fail = (why: string): never => {
    throw new Error(`Malformed export at line ${line}: ${why}`)
  }

  const payloadAt = tail.indexOf('payload=')
  const head = payloadAt === -1 ? tail : tail.slice(0, payloadAt)
  const fields = head.trim().split(/\s+/u)

  const [id, deviceId, createdAt, occurredAt, precision, mediaRef, type, ...rest] = fields

  if (!id || !deviceId || !createdAt || !occurredAt || !precision || !mediaRef || !type) {
    fail(`expected at least 7 fields, got ${fields.filter(Boolean).length}`)
  }
  if (!MEDIA_REF.test(mediaRef as string)) fail(`"${mediaRef}" is not a media reference`)
  if (!PRECISIONS.has(precision as string)) fail(`"${precision}" is not a date precision`)

  const cycleKey = rest.find((field) => field.startsWith('cycle='))?.slice('cycle='.length) ?? null

  const base = {
    id: id as string,
    device_id: deviceId as string,
    created_at: createdAt as Timestamp,
    occurred_at: occurredAt === '-' ? null : (occurredAt as Timestamp),
    occurred_precision: precision as DatePrecision,
    media_ref: mediaRef as MediaRef,
    cycle_key: cycleKey,
    type,
  }

  if (payloadAt === -1) return base as StoredEvent

  const encoded = tail.slice(payloadAt + 'payload='.length)
  try {
    return { ...base, payload: JSON.parse(encoded) } as StoredEvent
  } catch {
    return fail('payload is not valid JSON')
  }
}

/** Relit « Matrix (1999) » ou une référence nue, qui ne donne aucun titre. */
function readTitle(head: string): ExportTitle | null {
  const column = head.slice(16 + 2 + 7 + 2, 16 + 2 + 7 + 2 + 34).trim()
  if (column.length === 0 || MEDIA_REF.test(column)) return null

  const matched = TITLE_COLUMN.exec(column)
  if (!matched?.[1]) return null

  return {
    title: matched[1].trim(),
    year: matched[2] ? Number(matched[2]) : null,
  }
}
