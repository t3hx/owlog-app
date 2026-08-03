import { useSyncExternalStore } from 'react'

/**
 * Le seul palier de l'application.
 *
 * Le handoff ne definit qu'une bascule, a 1024px : en dessous, la colonne
 * mobile ; au-dessus, la sidebar. Le palier tablette n'existe pas — entre
 * 640 et 1023px, la colonne mobile est centree, et c'est une decision
 * assumee (design F9), pas un oubli. Inventer un palier intermediaire
 * creerait un troisieme layout que personne n'a dessine et que rien ne
 * verifie.
 */
const DESKTOP = '(min-width: 1024px)'

/**
 * Vrai au-dela de 1024px.
 *
 * `useSyncExternalStore` plutot qu'un `useState` + `useEffect` : la valeur
 * est lue au rendu, jamais apres. Un effet laisserait passer une premiere
 * frame en mode mobile sur un ecran large — la tab bar apparait puis
 * disparait, et le contenu saute.
 *
 * L'appelant ne remonte rien a la traversee du palier : seuls les elements
 * de chrome changent, les ecrans restent montes. Sans ca, redimensionner la
 * fenetre viderait la recherche en cours et remettrait le scroll a zero.
 */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, matches, offscreen)
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(DESKTOP)
  if (query === undefined) return () => {}

  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * `matchMedia` manque sous jsdom, ou aucun test ne monte de chrome. Le
 * defaut mobile y est le bon : c'est le format que les tests d'ecran
 * decrivent, et il n'exige aucun polyfill dans leur mise en place.
 */
function matches(): boolean {
  return window.matchMedia?.(DESKTOP).matches ?? false
}

function offscreen(): boolean {
  return false
}
