/**
 * Règles du bouton play de l'accueil.
 *
 * Elles vivent dans le domaine et non dans l'écran, parce qu'elles décident
 * du contenu d'un `PROG` écrit pour toujours. Un incrément calculé dans un
 * composant React serait la seule règle du modèle sans test.
 *
 * Ces deux fonctions sont pures et sans mémoire : elles répondent « de
 * combien » et « quel label ensuite », jamais « quand écrire ». Le
 * regroupement des taps en un seul événement est une affaire d'écran.
 */

/**
 * Incrément appliqué quand le nombre d'épisodes est inconnu ou inutilisable.
 *
 * Dix points font dix taps pour boucler un titre, ce qui reste un geste
 * crédible. C'est le cas des films et celui des séries dont TMDB ne renvoie
 * pas le compte.
 */
const FALLBACK_INCREMENT = 10

/**
 * Points de progression gagnés par tap sur le bouton play.
 *
 * **La valeur n'est pas arrondie.** Arrondir `100 / 8` à 13 ferait huit taps
 * à 104 %, et surtout ferait franchir 100 avant le dernier épisode : le
 * cycle se clorait sur l'avant-dernier. La valeur exacte garantit qu'un tap
 * par épisode clôt le cycle au bon moment, ni avant ni après.
 *
 * Corollaire pour l'appelant : `100 / 3` n'est pas exact en binaire, donc
 * trois taps donnent `100.00000000000001`. L'accumulateur **doit** borner à
 * 100 plutôt que comparer à l'égalité.
 *
 * @param episodeCount `number_of_episodes` de `media_cache`, souvent absent.
 */
export function episodeIncrement(episodeCount: number | null | undefined): number {
  // TMDB renvoie parfois 0 sur une série annoncée mais non diffusée. Diviser
  // par zéro donnerait l'infini, donc un premier tap à 100 %.
  if (episodeCount === null || episodeCount === undefined) return FALLBACK_INCREMENT
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) return FALLBACK_INCREMENT

  return 100 / episodeCount
}

/**
 * Un cycle est clos à 100 % : la progression ne va pas au-delà.
 *
 * Constante et non littéral disséminé, parce que trois endroits en dépendent :
 * la borne d'écriture, la projection optimiste du bouton play, et le seuil qui
 * fait émettre un `SEEN`.
 */
export const COMPLETE_PERCENT = 100

/**
 * Progression après un gain de `increment` points.
 *
 * **Unique définition de la borne.** Le `PROG` écrit et la barre affichée
 * doivent tomber sur la même valeur ; deux `Math.min` recopiés divergeraient
 * au premier changement de règle, et la barre reculerait au moment du flush.
 *
 * Borner ne relève pas du confort : `100 / 3` additionné trois fois donne
 * `100.00000000000001`, qui s'écrirait tel quel dans un événement immuable.
 */
export function advancePercent(percent: number, increment: number): number {
  return Math.min(COMPLETE_PERCENT, percent + increment)
}

/** Un avancement, tel que l'affiche l'accueil. */
export interface TapProjection {
  readonly percent: number
  readonly label: string | null
}

/**
 * Projection de `taps` taps sur le bouton play.
 *
 * L'affichage avance à chaque tap, l'écriture est regroupée : un seul `PROG`
 * après deux secondes sans tap. Cette fonction est ce que les deux chemins
 * partagent, et c'est ce qui garantit qu'ils s'accordent.
 *
 * Les points s'ajoutent **en une multiplication** et non tap par tap. Le
 * flush passe `taps × increment` à `advanceProgress`, qui fait une seule
 * addition : accumuler ici en boucle donnerait un autre arrondi binaire, donc
 * une barre qui saute d'un cheveu au moment de l'écriture.
 *
 * Le label, lui, s'incrémente bien une fois par tap — il n'y a pas d'autre
 * façon d'aller de `S01E01` à `S01E03`. **Sauf au tap qui clôt le cycle :**
 * le label répond « où j'en suis », et une fois à 100 % il n'y a plus de
 * suivant. Sans cette exception, dix taps sur une série de dix épisodes
 * écriraient `S01E11` — un épisode qui n'existe pas, gravé pour toujours
 * dans un store append-only.
 */
export function applyTaps(
  from: TapProjection,
  taps: number,
  increment: number,
): TapProjection {
  // Un compteur de taps négatif ou nul ne fait rien plutôt que de faire
  // reculer la barre : il vient d'un état React qu'un vidage concurrent peut
  // remettre à zéro sous les doigts.
  if (!Number.isFinite(taps) || taps <= 0) return from

  let label = from.label
  for (let done = 0; done < labelSteps(from.percent, taps, increment); done += 1) {
    label = nextEpisodeLabel(label)
  }

  return {
    percent: advancePercent(from.percent, taps * increment),
    label,
  }
}

/**
 * Nombre de fois que le label avance, pour `taps` taps.
 *
 * C'est le nombre de taps qui laissent le cycle **en cours**. Celui qui
 * atteint 100 % n'a pas de suivant à désigner.
 */
function labelSteps(percent: number, taps: number, increment: number): number {
  if (increment <= 0) return taps

  const toComplete = Math.ceil((COMPLETE_PERCENT - percent) / increment)
  return Math.max(0, Math.min(taps, toComplete - 1))
}

/** Un label d'épisode : `S` puis la saison, `E` puis l'épisode. */
const EPISODE_LABEL = /^s\d+e\d+$/i

/** Le numéro d'épisode, en fin de label. */
const EPISODE_NUMBER = /\d+$/

/**
 * Label de l'épisode suivant, quand le label courant en est un.
 *
 * La largeur d'origine du numéro est conservée : `S1E9` vient d'une saisie à
 * la main, et la respecter évite qu'un label change de forme sous les doigts
 * de celui qui l'a tapé. Le passage de la dizaine l'élargit quand il le faut
 * — `S1E9` donne `S1E10`, jamais `S1E0`.
 *
 * Deux cas rendent l'entrée inchangée plutôt qu'une invention :
 *
 * - un label libre (« la fin », « moitié », un titre d'épisode) est rendu tel
 *   quel : on ne devine pas, et un label inventé serait pire que pas de label ;
 * - sans label existant, la saison est inconnue. Écrire `S01E01` affirmerait
 *   quelque chose que personne n'a dit, donc `null` reste `null`.
 */
export function nextEpisodeLabel(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null

  if (!EPISODE_LABEL.test(label)) return label

  // Découpe plutôt que capture : le préfixe est recopié tel quel — casse et
  // zéros de tête de la saison compris — sans jamais être réinterprété.
  const start = label.search(EPISODE_NUMBER)
  const prefix = label.slice(0, start)
  const episode = label.slice(start)
  const next = String(Number(episode) + 1)

  return prefix + next.padStart(episode.length, '0')
}
