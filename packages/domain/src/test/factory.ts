import type {
  CycleKey,
  DomainEvent,
  UnknownEvent,
  Timestamp,
  MediaRef,
  DatePrecision,
} from '../types.ts'

/**
 * Fabrique d'événements pour les tests.
 *
 * Deux propriétés qui rendent les tests lisibles et déterministes :
 *
 * - `created_at` suit l'ordre d'appel. Écrire les événements dans l'ordre
 *   où on les construit modélise l'ordre d'écriture réel, ce qui est
 *   exactement la dimension que la règle de rang départage.
 * - `occurred_at` omis vaut `created_at`, ce qui est exactement la règle du
 *   domaine pour un événement live. Un test qui veut exercer la divergence
 *   entre les deux dates — le piège central du modèle — la rend donc
 *   explicite, et cette explicitation se voit à la lecture.
 *
 * `id` est séquentiel et lisible (`e0001`), pas un vrai UUIDv7 : ce qui
 * compte pour les règles, c'est qu'il soit ordonnable, et un compteur
 * zéro-paddé l'est. Un vrai UUID rendrait les échecs de test illisibles.
 */
export const MOVIE: MediaRef = 'tmdb:movie/693134'
export const SERIES: MediaRef = 'tmdb:tv/95396'

export interface Factory {
  watch(occurredAt?: Timestamp | null): DomainEvent
  remove(occurredAt?: Timestamp | null): DomainEvent
  start(cycle: CycleKey, occurredAt?: Timestamp | null, precision?: DatePrecision): DomainEvent
  rewatch(cycle: CycleKey, occurredAt?: Timestamp | null, precision?: DatePrecision): DomainEvent
  seen(cycle: CycleKey, occurredAt?: Timestamp | null, precision?: DatePrecision): DomainEvent
  drop(cycle: CycleKey, occurredAt?: Timestamp | null): DomainEvent
  prog(
    cycle: CycleKey,
    percent: number,
    options?: { label?: string; labelCreatedAt?: Timestamp; occurredAt?: Timestamp },
  ): DomainEvent
  rate(cycle: CycleKey, rating: number | null, occurredAt?: Timestamp): DomainEvent
  note(cycle: CycleKey, text: string, occurredAt?: Timestamp): DomainEvent
  fav(occurredAt?: Timestamp): DomainEvent
  unfav(occurredAt?: Timestamp): DomainEvent
  voided(target: string, occurredAt?: Timestamp): DomainEvent
  unknown(type: string, occurredAt?: Timestamp | null): UnknownEvent
  /** Dernier identifiant produit, pour cibler une annulation. */
  lastId(): string
}

/**
 * Compteur d'instances.
 *
 * Deux fabriques doivent produire des identifiants distincts : `events` a
 * une clé primaire unique, et un test multi-médias qui persiste réellement
 * échouerait sur une collision. Les réducteurs, eux, ne persistent rien —
 * c'est l'adaptateur qui a révélé le défaut.
 */
let instances = 0

export function createFactory(ref: MediaRef = MOVIE): Factory {
  instances += 1
  const prefix = `f${instances}`
  let counter = 0
  let last = ''

  /**
   * `occurredAt` omis (et non `null`) signifie « événement live » : la
   * fabrique pose alors `occurred_at = created_at`, ce qui est la règle du
   * domaine pour tout geste fait dans l'app.
   *
   * Sans ça, un `seen()` sans date explicite se retrouverait horodaté avant
   * le `start()` qu'il termine, et les tests d'ordre vérifieraient une
   * chronologie impossible.
   */
  function base(occurredAt: Timestamp | null | undefined, precision: DatePrecision) {
    counter += 1
    last = `${prefix}e${String(counter).padStart(4, '0')}`
    // Une seconde d'écart par appel : l'ordre d'écriture est l'ordre d'appel.
    const second = String(counter).padStart(2, '0')
    const writtenAt = `2026-01-01T00:00:${second}.000Z` as Timestamp
    return {
      id: last,
      device_id: 'test',
      created_at: writtenAt,
      occurred_at: occurredAt === undefined ? writtenAt : occurredAt,
      occurred_precision: precision,
      media_ref: ref,
    }
  }

  return {
    watch: (occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type: 'WATCH',
      cycle_key: null,
    }),
    remove: (occurredAt) => ({
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
    seen: (cycle, occurredAt, precision = 'exact') => ({
      ...base(occurredAt, precision),
      type: 'SEEN',
      cycle_key: cycle,
    }),
    drop: (cycle, occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type: 'DROP',
      cycle_key: cycle,
    }),
    prog: (cycle, percent, options = {}) => ({
      ...base(options.occurredAt, 'exact'),
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
    rate: (cycle, rating, occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type: 'RATE',
      cycle_key: cycle,
      payload: { rating },
    }),
    note: (cycle, text, occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type: 'NOTE',
      cycle_key: cycle,
      payload: { text },
    }),
    fav: (occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type: 'FAV',
      cycle_key: null,
    }),
    unfav: (occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type: 'UNFAV',
      cycle_key: null,
    }),
    voided: (target, occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type: 'VOID',
      cycle_key: null,
      payload: { target: target },
    }),
    unknown: (type, occurredAt) => ({
      ...base(occurredAt, 'exact'),
      type,
      cycle_key: null,
    }),
    lastId: () => last,
  }
}
