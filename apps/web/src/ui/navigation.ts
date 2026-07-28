/**
 * Onglets de l'application.
 *
 * Quatre onglets au temps 1 : accueil, bibliothèque, log, stats.
 *
 * Le handoff se contredit sur la quatrième case — son README dit « amis »,
 * son design-system.md dit « profil » — et les deux sont hors périmètre du
 * temps 1 (ils exigent un backend multi-utilisateur). L'écran LOG global
 * prend la place : il rend visible la thèse produit, le visionnage comme
 * unité d'enregistrement, au lieu de la cacher en bas de la page média.
 *
 * Pas d'onglet mort : un onglet qui ouvre un écran vide est pire qu'un
 * onglet absent.
 *
 * Les libellés ne sont pas ici : ce sont des clés de traduction, résolues
 * au rendu. Un tableau de constantes n'a pas de langue.
 */
export interface Tab {
  /** Chemin, en mode history. */
  readonly path: string
  /** Clé du libellé affiché sous l'icône, en mono 9px. */
  readonly labelKey: 'nav.home' | 'nav.library' | 'nav.log' | 'nav.stats'
}

export const TABS: readonly Tab[] = [
  { path: '/', labelKey: 'nav.home' },
  { path: '/library', labelKey: 'nav.library' },
  { path: '/log', labelKey: 'nav.log' },
  { path: '/stats', labelKey: 'nav.stats' },
]
