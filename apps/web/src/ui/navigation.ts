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
 */
export interface Tab {
  /** Chemin, en mode history. */
  readonly path: string
  /** Label affiché sous l'icône, en mono 9px. */
  readonly label: string
  /** Titre de l'écran, utilisé par le document et l'en-tête. */
  readonly titre: string
}

export const TABS: readonly Tab[] = [
  { path: '/', label: 'accueil', titre: 'Accueil' },
  { path: '/bibliotheque', label: 'bibliothèque', titre: 'Bibliothèque' },
  { path: '/log', label: 'log', titre: 'Log' },
  { path: '/stats', label: 'stats', titre: 'Stats' },
]
