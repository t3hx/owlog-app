import { cycles } from '../rules/cycles.ts'
import { isKnownEvent, type MediaRef, type StoredEvent, type Timestamp } from '../types.ts'

/**
 * Formateur `.log`.
 *
 * C'est le filet de sécurité du projet. IndexedDB peut être évincé, et sur
 * iOS désinstaller une PWA efface son stockage : ce fichier est la seule
 * chose qui survit au geste. Il en découle une contrainte qui prime sur
 * l'esthétique — **tout ce qui est écrit doit se relire à l'identique.**
 *
 * D'où la forme en deux parties. Avant la barre, ce qu'un humain lit : une
 * date, un type, un titre, un rang de visionnage. Après, ce qui reconstruit
 * l'événement. La tête est décorative et le parseur ne la lit pas ; elle peut
 * donc être tronquée et assainie sans rien perdre.
 *
 * ```
 *   2019-06-01 20:00  SEEN     Matrix (1999)          #1  | <id> <device> …
 *   └─ pour l'œil, jamais relu ────────────────────────┘    └─ autoritatif ─┘
 * ```
 *
 * **Les `PROG` sont relégués en fin de fichier, pas retirés.** Personne ne
 * veut relire qu'il a poussé la barre à 30 % un mardi soir — mais une
 * sauvegarde qui les jette fait revenir une série de 60 % à 0 %, sans que
 * rien à l'écran ne le signale : le statut reste « en cours ». Le corps reste
 * narratif, le fichier reste une sauvegarde.
 */

/** Ce que le formateur a besoin de savoir d'un média pour l'écrire en clair. */
export interface ExportTitle {
  readonly title: string
  readonly year: number | null
}

/** Version du format, relue à l'import. */
export const EXPORT_VERSION = 1

/** En-tête de la section de progression. C'est aussi un commentaire. */
export const PROGRESS_SECTION = '# --- progression (hors récit, requis pour la restauration) ---'

/** Sépare la tête décorative de la queue autoritative. */
export const SEPARATOR = ' | '

const DATE_WIDTH = 16
const TYPE_WIDTH = 7
const TITLE_WIDTH = 34
const DETAIL_WIDTH = 16

/**
 * Rend le store en texte relisable.
 *
 * `now` est passé plutôt que lu : le domaine n'a pas le droit de connaître
 * `Date`, et un en-tête horodaté par le formateur lui-même rendrait la sortie
 * non déterministe, donc intestable.
 */
export function format(
  events: readonly StoredEvent[],
  titles: ReadonlyMap<MediaRef, ExportTitle>,
  now: Timestamp,
  settings: ReadonlyMap<string, string> = new Map(),
): string {
  const ordered = [...events].sort(byId)
  const ranks = ranksByCycle(ordered)

  const narrative = ordered.filter((event) => event.type !== 'PROG')
  const progress = ordered.filter((event) => event.type === 'PROG')

  const lines = [
    `# owlog · export v${EXPORT_VERSION} · ${now} · ${ordered.length} événement(s)`,
    '#',
    "# Une ligne, un événement. Avant la barre verticale, c'est pour l'œil ;",
    "# après, c'est ce qui reconstruit le journal. Les commentaires et les",
    "# lignes vides sont ignorés à la relecture : ce fichier s'annote.",
    ...settingLines(settings),
    '',
    ...narrative.map((event) => line(event, titles, ranks)),
  ]

  if (progress.length > 0) {
    lines.push('', PROGRESS_SECTION, '')
    lines.push(...progress.map((event) => line(event, titles, ranks)))
  }

  return `${lines.join('\n')}\n`
}

/**
 * Réglages, en commentaires.
 *
 * Ils ne sont pas des événements et n'ont pas d'historique — les mêler aux
 * lignes du journal serait une erreur de catégorie. Mais un fichier qui rend
 * les événements sans le prénom laisse l'app à son écran de première
 * ouverture, lequel affirme « ton log est vide » par-dessus un log restauré.
 *
 * La forme commentée n'est pas un contournement : elle rend le fichier
 * relisable par une version du parseur qui ignore les réglages, puisqu'elle
 * les saute comme n'importe quel commentaire. La valeur est encodée en JSON,
 * ce qui laisse passer les espaces, les accents et le signe égal.
 */
function settingLines(settings: ReadonlyMap<string, string>): readonly string[] {
  if (settings.size === 0) return []

  return [
    '#',
    ...[...settings]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `# setting ${key} = ${JSON.stringify(value)}`),
  ]
}

function line(
  event: StoredEvent,
  titles: ReadonlyMap<MediaRef, ExportTitle>,
  ranks: ReadonlyMap<string, number>,
): string {
  const head = [
    pad(displayDate(event), DATE_WIDTH),
    pad(event.type, TYPE_WIDTH),
    pad(displayTitle(event.media_ref, titles), TITLE_WIDTH),
    pad(detail(event, ranks), DETAIL_WIDTH),
  ].join('  ')

  return `${head}${SEPARATOR}${tail(event)}`
}

/**
 * Queue autoritative.
 *
 * Sept champs positionnels, puis des paires nommées optionnelles. `payload`
 * vient toujours en dernier et prend tout le reste de la ligne : c'est ce qui
 * permet à un commentaire d'utilisateur de contenir des espaces, des
 * guillemets et même le séparateur de colonnes sans casser la relecture.
 *
 * Le type est ici et non seulement dans la colonne lisible : celle-ci est
 * tronquée et assainie, donc rien de ce qui compte ne peut n'exister que là.
 */
function tail(event: StoredEvent): string {
  const fields = [
    event.id,
    event.device_id,
    event.created_at,
    event.occurred_at ?? '-',
    event.occurred_precision,
    event.media_ref,
    event.type,
  ]

  if (event.cycle_key !== null) fields.push(`cycle=${event.cycle_key}`)

  const payload = (event as { payload?: unknown }).payload
  if (payload !== undefined) fields.push(`payload=${JSON.stringify(payload)}`)

  return fields.join(' ')
}

/**
 * Rang du cycle, calculé par `cycles()` et jamais réimplémenté ici.
 *
 * La règle de rang sert déjà la numérotation `#N` du journal, la dérivation
 * du statut et le tri. Une deuxième définition dans le formateur divergerait
 * en silence, et l'écart ne se verrait que dans un fichier de sauvegarde —
 * c'est-à-dire jamais, jusqu'au jour où il compte.
 */
function ranksByCycle(events: readonly StoredEvent[]): ReadonlyMap<string, number> {
  const byMedia = new Map<MediaRef, StoredEvent[]>()

  for (const event of events) {
    const bucket = byMedia.get(event.media_ref)
    if (bucket) bucket.push(event)
    else byMedia.set(event.media_ref, [event])
  }

  const ranks = new Map<string, number>()
  for (const mediaEvents of byMedia.values()) {
    for (const cycle of cycles(mediaEvents)) ranks.set(cycle.key, cycle.rank)
  }

  return ranks
}

/**
 * Date telle qu'on la lit, à la précision assumée.
 *
 * Une date affichée plus finement qu'elle n'est connue est un mensonge : sur
 * un rétro-datage à l'année, écrire `2019-01-01 00:00` ferait croire à un
 * horodatage exact. La queue porte la valeur complète, la tête dit ce qu'on
 * sait vraiment.
 */
function displayDate(event: StoredEvent): string {
  if (event.occurred_at === null) return '?'

  const at = event.occurred_at
  switch (event.occurred_precision) {
    case 'year':
      return at.slice(0, 4)
    case 'month':
      return at.slice(0, 7)
    case 'day':
      return at.slice(0, 10)
    default:
      return `${at.slice(0, 10)} ${at.slice(11, 16)}`
  }
}

function displayTitle(ref: MediaRef, titles: ReadonlyMap<MediaRef, ExportTitle>): string {
  const known = titles.get(ref)
  // Une ligne de cache est perdable par conception. Sortir la reference nue
  // garde le fichier reimportable ; lever une exception le rendrait
  // impossible a produire au moment ou l'on en a le plus besoin.
  if (!known) return ref

  return known.year === null ? known.title : `${known.title} (${known.year})`
}

function detail(event: StoredEvent, ranks: ReadonlyMap<string, number>): string {
  const rank = event.cycle_key === null ? null : ranks.get(event.cycle_key)
  const prefix = rank === undefined || rank === null ? '' : `#${rank}`

  if (!isKnownEvent(event)) return prefix

  switch (event.type) {
    case 'PROG': {
      const label = event.payload.label
      return [prefix, `${event.payload.percent}%`, label].filter(Boolean).join(' ')
    }
    case 'RATE':
      return `${prefix} ${event.payload.rating === null ? '★—' : `★${event.payload.rating}`}`.trim()
    case 'NOTE':
      return `${prefix} ${quote(event.payload.text)}`.trim()
    case 'VOID':
      return `annule ${event.payload.target.slice(0, 8)}`
    default:
      return prefix
  }
}

/** Aperçu d'un commentaire, sur une seule ligne et borné. */
function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 24 ? `« ${flat.slice(0, 23)}… »` : `« ${flat} »`
}

/**
 * Cale une colonne, en assainissant ce qui casserait la lecture.
 *
 * Le séparateur et les retours à la ligne sont retires de la tete : elle est
 * decorative et jamais relue, donc la tronquer ne perd rien. La queue, elle,
 * echappe tout ce qu'elle porte.
 */
function pad(value: string, width: number): string {
  const clean = value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '¦')
  const cut = clean.length > width ? `${clean.slice(0, width - 1)}…` : clean

  return cut.padEnd(width)
}

function byId(a: StoredEvent, b: StoredEvent): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
