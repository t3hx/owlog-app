import type { Status } from '@owlog/domain'

/**
 * Habillage des quatre statuts, partagé par la fiche et par la bibliothèque.
 *
 * **Les classes sont écrites en dur, jamais composées.** Tailwind analyse le
 * source en texte : une classe fabriquée à l'exécution
 * (`border-status-${option}`) n'existe dans aucun fichier, donc la règle
 * n'est jamais générée et la pastille sort sans couleur. Le piège est
 * silencieux — rien ne casse, la couleur manque simplement.
 *
 * Les couleurs suivent le handoff : à voir jaune, en cours menthe, vu bleu,
 * abandonné rouge, à 10-12 % en fond et 40-45 % en bordure.
 */
export const STATUS_CHIP: Record<Status, { readonly on: string; readonly off: string }> = {
  'to-watch': {
    on: 'border-status-watch bg-status-watch/10 text-status-watch',
    off: 'border-border text-muted',
  },
  watching: {
    on: 'border-status-current bg-status-current/10 text-status-current',
    off: 'border-border text-muted',
  },
  seen: {
    on: 'border-status-seen bg-status-seen/10 text-status-seen',
    off: 'border-border text-muted',
  },
  dropped: {
    on: 'border-status-dropped bg-status-dropped/10 text-status-dropped',
    off: 'border-border text-muted',
  },
}

/**
 * Glyphe qui précède le libellé d'un statut.
 *
 * Repris du handoff : `+ à voir`, `● en cours`, `✓ vu`, `✕ abandonné`. Ils ne
 * passent pas par l'i18n — ce sont des symboles, pas de la prose, et les
 * traduire n'aurait pas de sens.
 */
export const STATUS_GLYPH: Record<Status, string> = {
  'to-watch': '+',
  watching: '●',
  seen: '✓',
  dropped: '✕',
}

/** Les quatre statuts, dans l'ordre de la boucle de la pastille. */
export const STATUSES: readonly Status[] = ['to-watch', 'watching', 'seen', 'dropped']
