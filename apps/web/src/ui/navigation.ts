/**
 * Onglets de l'application.
 *
 * Quatre onglets : accueil, bibliothèque, stats, amis.
 *
 * **La quatrième case est « amis » depuis la décision D2.2** (gate du
 * 2026-07-31, consignée dans `social.md` §Navigation). Le handoff se
 * contredisait — son README disait « amis », son design-system « profil » —
 * et le temps 1 y avait posé le LOG global en substitut assumé, faute de
 * backend multi-utilisateur. Le backend existe (T3H-62), l'écran aussi
 * (T3H-64) : la substitution prend fin ici.
 *
 * **LOG est relogé, pas supprimé.** La route `/log` est conservée et
 * l'entrée vit en tête de l'écran Stats. Un écran qui perd son onglet ne
 * doit pas perdre son chemin — les liens déjà ouverts, les signets et le
 * retour arrière continuent de fonctionner.
 *
 * Pas d'onglet mort : un onglet qui ouvre un écran vide est pire qu'un
 * onglet absent. C'est cette règle qui a fait attendre la bascule jusqu'au
 * lot qui livre l'écran, et non l'inverse.
 *
 * Les libellés ne sont pas ici : ce sont des clés de traduction, résolues
 * au rendu. Un tableau de constantes n'a pas de langue.
 */
export interface Tab {
  /** Chemin, en mode history. */
  readonly path: string
  /** Clé du libellé affiché sous l'icône, en mono 9px. */
  readonly labelKey: 'nav.home' | 'nav.library' | 'nav.stats' | 'nav.friends'
  /**
   * Forme de l'icône active.
   *
   * Le prototype dessine la case « amis » en cercle et les autres en carré
   * arrondi : le cercle est un avatar, et c'est ce qui distingue « des
   * gens » de « des écrans ». La forme suit donc l'onglet, elle ne se
   * déduit pas de sa position.
   */
  readonly shape: 'square' | 'round'
}

export const TABS: readonly Tab[] = [
  { path: '/', labelKey: 'nav.home', shape: 'square' },
  { path: '/library', labelKey: 'nav.library', shape: 'square' },
  { path: '/stats', labelKey: 'nav.stats', shape: 'square' },
  { path: '/friends', labelKey: 'nav.friends', shape: 'round' },
]

/**
 * Un onglet est-il celui de l'écran courant ?
 *
 * **Les sous-routes comptent.** `/friends/nova` est encore l'onglet Amis :
 * une correspondance exacte l'éteignait dès l'ouverture d'un profil, et en
 * desktop le résultat était visiblement faux — la sidebar montrait « amis »
 * inactif pendant que la liste des amis occupait la moitié de l'écran, à
 * côté du profil ouvert.
 *
 * La racine est traitée à part : sans ça, `/` préfixe tout et allumerait
 * l'accueil sur chaque écran de l'application.
 */
export function isTabActive(tab: Tab, location: string): boolean {
  if (tab.path === '/') return location === '/'
  return location === tab.path || location.startsWith(`${tab.path}/`)
}
