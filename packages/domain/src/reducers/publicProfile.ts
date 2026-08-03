import { applyVoids } from './applyVoids.ts'
import { filterLibrary, type MediaStateRow } from './mediaState.ts'
import { compatibility } from '../rules/compatibility.ts'
import { compareEventsDesc, HIDDEN_FROM_HISTORY } from '../rules/history.ts'
import type { MediaRef, StoredEvent, Timestamp } from '../types.ts'

/**
 * Ce que le lecteur est pour le propriétaire du profil.
 *
 * **Le domaine ne détermine jamais cette valeur, il la reçoit.** Savoir si
 * deux comptes sont amis est une question de table `friendships`, donc
 * d'infrastructure ; la projection, elle, doit rester une fonction pure
 * rejouable côté client comme côté serveur.
 */
export type ProfileViewer = 'self' | 'friend' | 'stranger'

/**
 * Ce que le profil a besoin de savoir d'un média.
 *
 * Un sous-ensemble de `media_cache`, redéclaré ici pour la même raison que
 * `StatsMedia` : le domaine ne dépend pas de la forme d'une copie locale
 * d'API tierce.
 */
export interface ProfileMedia {
  readonly title: string | null
  readonly posterPath: string | null
  readonly year: number | null
}

/**
 * Types d'événements publiables — **whitelist positive**.
 *
 * Énumérer ce qui sort, et non ce qui reste, est la seule forme qui résiste
 * au temps. Un type écrit par une version ultérieure du client est inconnu
 * ici, donc absent de cette liste, donc jamais publié : il peut porter
 * n'importe quelle charge utile privée sans que ce fichier ait à le savoir.
 * Une liste d'exclusions l'aurait publié avec son payload, et personne ne
 * l'aurait vu venir.
 *
 * Ce qui n'y figure pas, et pourquoi :
 *
 * - `NOTE` — texte libre de l'utilisateur, la donnée la plus privée du
 *   produit. Elle ne sort par aucun chemin, pas même chez un ami.
 * - `RATE` — une note est un jugement ; rien dans la spécification des
 *   écrans 8 et 9 ne la rend publique, donc elle ne l'est pas.
 * - `UNFAV` — retirer un coup de cœur est une rétractation. La diffuser
 *   n'apporte rien et se lit comme un désaveu.
 * - `PROG`, `VOID` — l'un est du bruit d'avancement, l'autre de la
 *   comptabilité interne. Ni l'un ni l'autre ne raconte quoi que ce soit.
 */
const PUBLIC_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'WATCH',
  'START',
  'REWATCH',
  'SEEN',
  'DROP',
  'FAV',
])

/**
 * Longueur par défaut de l'activité rendue.
 *
 * Bornée parce que cette projection devient une réponse HTTP : un compte
 * chargé par l'import TVTime en compterait des milliers, et rien dans
 * l'écran 9 ne les affiche.
 */
export const DEFAULT_ACTIVITY_LIMIT = 20

/**
 * Nombre d'affiches de `▸ SES COUPS DE CŒUR`.
 *
 * Bornée pour la même raison que l'activité, et il faut le dire : la
 * section ne l'était pas dans la première version, ce qui aurait renvoyé
 * plusieurs milliers d'affiches sur un compte issu de l'import TVTime —
 * chacune avec sa lecture de cache. L'écran 9 en montre une rangée.
 */
export const DEFAULT_FAVORITES_LIMIT = 24

export interface PublicProfileInput {
  readonly pseudo: string
  /**
   * `users.created_at`, en donnée.
   *
   * Le domaine n'a pas le droit de connaître `Date` : « membre depuis » est
   * donc une valeur qu'on lui passe, jamais une date qu'il lit.
   */
  readonly memberSince: Timestamp
  readonly viewer: ProfileViewer
  readonly states: readonly MediaStateRow[]
  readonly eventsByMedia: ReadonlyMap<MediaRef, readonly StoredEvent[]>
  readonly cache: ReadonlyMap<MediaRef, ProfileMedia>
  /** Bibliothèque du lecteur, pour la compat. Absente : `compat` vaut `null`. */
  readonly viewerStates?: readonly MediaStateRow[]
  readonly activityLimit?: number
  readonly favoritesLimit?: number
}

/** Une affiche de la section `▸ SES COUPS DE CŒUR`. */
export interface ProfileFavorite {
  readonly ref: MediaRef
  readonly title: string | null
  readonly posterPath: string | null
  readonly year: number | null
}

/** Une ligne de la section `▸ ACTIVITÉ`. */
export interface ProfileActivityLine {
  readonly ref: MediaRef
  readonly type: string
  readonly title: string | null
  readonly at: Timestamp | null
}

/** Ce que voit un non-ami : rien de la bibliothèque, rien de l'activité. */
export interface MinimalProfile {
  readonly kind: 'minimal'
  readonly pseudo: string
  readonly memberSince: Timestamp
}

interface ProfileBody {
  readonly pseudo: string
  readonly memberSince: Timestamp
  /** `N titres loggés` — tout ce qui est dans la bibliothèque. */
  readonly loggedCount: number
  readonly seenCount: number
  readonly favoriteCount: number
  readonly favorites: readonly ProfileFavorite[]
  readonly activity: readonly ProfileActivityLine[]
}

/**
 * Son propre profil, tel qu'un ami le verra.
 *
 * **Aucun champ `compat`**, et c'est structurel : la compatibilité avec
 * soi-même n'a pas de sens, donc aucun écran ne peut rendre la tuile par
 * accident. La règle est une propriété de type, pas une consigne d'écran.
 */
export interface OwnProfile extends ProfileBody {
  readonly kind: 'own'
}

export interface FriendProfile extends ProfileBody {
  readonly kind: 'friend'
  /** `null` sans recouvrement : l'écran rend `—`, jamais `0 %`. */
  readonly compat: number | null
}

export type PublicProfileView = MinimalProfile | OwnProfile | FriendProfile

/**
 * Unique source de ce qu'un profil laisse voir.
 *
 * ```
 *   viewer: 'stranger' ──▶ { kind: 'minimal' }   pseudo + inscription
 *   viewer: 'self'     ──▶ { kind: 'own' }       tout, sans compat
 *   viewer: 'friend'   ──▶ { kind: 'friend' }    tout, avec compat
 * ```
 *
 * **Union discriminée, et non un objet à champs optionnels.** C'est ce qui
 * fait de la whitelist une propriété du type plutôt qu'une discipline de
 * filtrage : `MinimalProfile` ne *peut pas* porter d'activité. Un objet
 * unique avec `activity?:` satisfait les mêmes tests aujourd'hui et fuit le
 * jour où quelqu'un rend le champ obligatoire.
 *
 * Le handler n'assemble pas et ne filtre pas — il choisit `viewer` et rend
 * ce qui sort d'ici. Toute recomposition côté route rouvrirait le chemin de
 * fuite que cette fonction existe pour fermer.
 */
export function publicProfile(input: PublicProfileInput): PublicProfileView {
  if (input.viewer === 'stranger') {
    return { kind: 'minimal', pseudo: input.pseudo, memberSince: input.memberSince }
  }

  const inLibrary = filterLibrary(input.states, 'all')
  const favorites = filterLibrary(input.states, 'favorites')

  const body: ProfileBody = {
    pseudo: input.pseudo,
    memberSince: input.memberSince,
    loggedCount: inLibrary.length,
    // Mêmes prédicats que les chips de la bibliothèque et que les tuiles de
    // l'écran de stats : une seule définition de « vu » et de « coup de
    // cœur » pour toutes les surfaces qui les comptent.
    seenCount: filterLibrary(input.states, 'seen').length,
    // Le compteur porte le TOTAL, la liste est tronquée : la tuile `♥ N`
    // doit dire combien il y en a, pas combien on en montre.
    favoriteCount: favorites.length,
    favorites: [...favorites]
      .sort(byRecency)
      .slice(0, input.favoritesLimit ?? DEFAULT_FAVORITES_LIMIT)
      .map((row) => ({ ref: row.ref, ...readMedia(input.cache, row.ref) })),
    activity: activityOf(input),
  }

  if (input.viewer === 'self') return { kind: 'own', ...body }

  return {
    kind: 'friend',
    ...body,
    compat:
      input.viewerStates === undefined
        ? null
        : compatibility(input.states, input.viewerStates),
  }
}

/**
 * Ordre des affiches : le plus récemment touché d'abord.
 *
 * Tronquer sans ordonner rendrait une sélection arbitraire et instable
 * d'un appel à l'autre — la même bibliothèque montrerait des affiches
 * différentes selon l'ordre de lecture de la base.
 */
function byRecency(a: MediaStateRow, b: MediaStateRow): number {
  if (a.updatedAt === b.updatedAt) return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0
  if (a.updatedAt === null) return 1
  if (b.updatedAt === null) return -1
  return a.updatedAt < b.updatedAt ? 1 : -1
}

/**
 * La section `▸ ACTIVITÉ`.
 *
 * **La même donnée que le LOG, jamais la même sortie.** Les règles sont
 * partagées avec `log()` — `applyVoids` en tête de chaîne, exclusion des
 * types non narratifs, ordre décroissant de `rules/history.ts` — mais `log()`
 * rend l'événement brut, charge utile comprise. Le publier ici diffuserait
 * le texte des `NOTE`. Ce qui sort est donc une ligne projetée : référence,
 * type, titre, date. Rien d'autre ne traverse.
 *
 * Deux filtres, deux questions distinctes, et il faut passer les deux :
 * `PUBLIC_ACTIVITY_TYPES` répond « est-ce publiable ? », `HIDDEN_FROM_HISTORY`
 * répond « est-ce narratif ? ». Un type ajouté à la seconde disparaît donc
 * aussi d'ici, sans qu'on ait à y penser.
 */
function activityOf(input: PublicProfileInput): readonly ProfileActivityLine[] {
  const lines: { event: StoredEvent; ref: MediaRef }[] = []

  for (const [ref, events] of input.eventsByMedia) {
    for (const event of applyVoids(events)) {
      if (!PUBLIC_ACTIVITY_TYPES.has(event.type)) continue
      if (HIDDEN_FROM_HISTORY.has(event.type)) continue
      lines.push({ event, ref })
    }
  }

  lines.sort((a, b) => compareEventsDesc(a.event, b.event))

  return lines.slice(0, input.activityLimit ?? DEFAULT_ACTIVITY_LIMIT).map(({ event, ref }) => ({
    ref,
    type: event.type,
    title: readMedia(input.cache, ref).title,
    at: event.occurred_at,
  }))
}

/**
 * Lecture défensive d'une fiche de cache.
 *
 * Le type statique ne prouve rien sur ce qui a réellement été écrit : ces
 * lignes viennent d'une copie locale d'une API tierce, remplies par des
 * versions successives du client. Une fiche absente ou un champ du mauvais
 * type dégradent vers `null` — jamais `undefined`, qui disparaîtrait de la
 * sérialisation JSON et ferait croire à l'écran que la clé n'existe pas.
 */
function readMedia(
  cache: ReadonlyMap<MediaRef, ProfileMedia>,
  ref: MediaRef,
): Omit<ProfileFavorite, 'ref'> {
  const row = cache.get(ref)

  return {
    title: typeof row?.title === 'string' ? row.title : null,
    posterPath: typeof row?.posterPath === 'string' ? row.posterPath : null,
    year: typeof row?.year === 'number' && Number.isFinite(row.year) ? row.year : null,
  }
}
