import type {
  CycleKey,
  Evenement,
  EvenementInconnu,
  Horodatage,
  MediaRef,
  Precision,
} from '@/domain/types'

/**
 * Fabrique d'événements pour les tests.
 *
 * Deux propriétés qui rendent les tests lisibles et déterministes :
 *
 * - `created_at` suit l'ordre d'appel. Écrire les événements dans l'ordre
 *   où on les construit modélise l'ordre d'écriture réel, ce qui est
 *   exactement la dimension que la règle de rang départage.
 * - `occurred_at` est toujours explicite. Le piège central du modèle vient
 *   de la divergence entre les deux dates ; laisser l'une implicite dans un
 *   test la rendrait invisible au moment de lire le test.
 *
 * `id` est séquentiel et lisible (`e0001`), pas un vrai UUIDv7 : ce qui
 * compte pour les règles, c'est qu'il soit ordonnable, et un compteur
 * zéro-paddé l'est. Un vrai UUID rendrait les échecs de test illisibles.
 */
export const FILM: MediaRef = 'tmdb:movie/693134'
export const SERIE: MediaRef = 'tmdb:tv/95396'

export interface Fabrique {
  watch(occurredAt?: Horodatage | null): Evenement
  remove(occurredAt?: Horodatage | null): Evenement
  start(cycle: CycleKey, occurredAt: Horodatage | null, precision?: Precision): Evenement
  rewatch(cycle: CycleKey, occurredAt: Horodatage | null, precision?: Precision): Evenement
  seen(cycle: CycleKey, occurredAt?: Horodatage | null): Evenement
  drop(cycle: CycleKey, occurredAt?: Horodatage | null): Evenement
  prog(
    cycle: CycleKey,
    percent: number,
    options?: { label?: string; labelCreatedAt?: Horodatage; occurredAt?: Horodatage },
  ): Evenement
  rate(cycle: CycleKey, rating: number | null, occurredAt?: Horodatage): Evenement
  note(cycle: CycleKey, text: string, occurredAt?: Horodatage): Evenement
  fav(occurredAt?: Horodatage): Evenement
  unfav(occurredAt?: Horodatage): Evenement
  annule(cible: string, occurredAt?: Horodatage): Evenement
  inconnu(type: string, occurredAt?: Horodatage | null): EvenementInconnu
  /** Dernier identifiant produit, pour cibler une annulation. */
  dernierId(): string
}

export function creerFabrique(ref: MediaRef = FILM): Fabrique {
  let compteur = 0
  let dernier = ''

  function base(occurredAt: Horodatage | null, precision: Precision) {
    compteur += 1
    dernier = `e${String(compteur).padStart(4, '0')}`
    // Une seconde d'écart par appel : l'ordre d'écriture est l'ordre d'appel.
    const seconde = String(compteur).padStart(2, '0')
    return {
      id: dernier,
      device_id: 'test',
      created_at: `2026-01-01T00:00:${seconde}.000Z` as Horodatage,
      occurred_at: occurredAt,
      occurred_precision: precision,
      media_ref: ref,
    }
  }

  const MAINTENANT = '2026-01-01T00:00:00.000Z'

  return {
    watch: (occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'WATCH',
      cycle_key: null,
    }),
    remove: (occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'REMOVE',
      cycle_key: null,
    }),
    start: (cycle, occurredAt, precision = 'exact') => ({
      ...base(occurredAt, precision),
      type: 'START',
      cycle_key: cycle,
    }),
    rewatch: (cycle, occurredAt, precision = 'exact') => ({
      ...base(occurredAt, precision),
      type: 'REWATCH',
      cycle_key: cycle,
    }),
    seen: (cycle, occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'SEEN',
      cycle_key: cycle,
    }),
    drop: (cycle, occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'DROP',
      cycle_key: cycle,
    }),
    prog: (cycle, percent, options = {}) => ({
      ...base(options.occurredAt ?? MAINTENANT, 'exact'),
      type: 'PROG',
      cycle_key: cycle,
      payload: {
        percent,
        ...(options.label === undefined ? {} : { label: options.label }),
        ...(options.labelCreatedAt === undefined
          ? {}
          : { label_created_at: options.labelCreatedAt }),
      },
    }),
    rate: (cycle, rating, occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'RATE',
      cycle_key: cycle,
      payload: { rating },
    }),
    note: (cycle, text, occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'NOTE',
      cycle_key: cycle,
      payload: { text },
    }),
    fav: (occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'FAV',
      cycle_key: null,
    }),
    unfav: (occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'UNFAV',
      cycle_key: null,
    }),
    annule: (cible, occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type: 'VOID',
      cycle_key: null,
      payload: { target: cible },
    }),
    inconnu: (type, occurredAt = MAINTENANT) => ({
      ...base(occurredAt, 'exact'),
      type,
      cycle_key: null,
    }),
    dernierId: () => dernier,
  }
}
