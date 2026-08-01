import { useCallback, useEffect, useReducer, useRef } from 'react'

import { systemClock, uuidv7Generator } from '@/adapters/browser/clock'
import { advanceProgress, setStatus, progress, applyTaps, type MediaRef } from '@owlog/domain'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Délai d'inactivité avant l'écriture, en millisecondes.
 *
 * Deux secondes, valeur du document de design. Assez long pour absorber la
 * rafale de taps de quelqu'un qui rattrape quatre épisodes, assez court pour
 * que reposer le téléphone suffise à sauvegarder.
 */
const IDLE_BEFORE_WRITE = 2000

interface Batch {
  /** Taps encaissés et pas encore écrits. */
  readonly taps: number
  /** Points par tap, figés à la première frappe de la rafale. */
  readonly increment: number
}

/**
 * Bouton play : l'affichage avance tout de suite, l'écriture est regroupée.
 *
 * Un tap par épisode sur une série de dix, c'est dix événements `PROG` dans
 * le journal pour une seule soirée. Le journal est la thèse du produit et il
 * se lit ; le noyer sous des lignes de progression le rendrait illisible.
 * D'où la règle : un seul `PROG` après deux secondes sans tap, ou dès que la
 * page passe en arrière-plan.
 *
 * **Ce hook ne décide de rien.** Combien vaut un tap et quel est le label
 * suivant sont des règles de `domain/rules/progression`. Ce qui vit ici est
 * la minuterie, c'est-à-dire la seule chose qui ne soit pas une règle métier.
 *
 * Le compte de taps est tenu dans une `ref` et non dans un `state` : la
 * minuterie et les écouteurs de page ont besoin de la valeur courante, et une
 * fermeture sur un `state` leur en donnerait une périmée — le cas classique
 * où le premier tap s'écrit et les suivants disparaissent. Le rendu est
 * redemandé explicitement.
 *
 * Le hook porte aussi `markSeen`, la moitié « film » du play adaptatif, et
 * `startWatching`, le play d'un titre à voir : même geste, autres écritures.
 * Les trois vivent ensemble parce qu'ils partagent la même exigence — un tap
 * protégé contre son double — et que chaque surface de play choisit selon
 * `hasEpisodes` et le statut du titre.
 */
export function usePlay() {
  const { events, deviceId } = usePorts()
  const batches = useRef(new Map<MediaRef, Batch>())
  const timers = useRef(new Map<MediaRef, ReturnType<typeof setTimeout>>())
  const writing = useRef(new Set<MediaRef>())
  const [, render] = useReducer((tick: number) => tick + 1, 0)

  // Pas de lecture réactive : la commande relit le journal du média au
  // moment d'écrire, ce qui garde le regroupement juste même si un autre
  // écran a écrit entre-temps.
  const flush = useCallback(
    async (ref: MediaRef): Promise<void> => {
      const batch = batches.current.get(ref)
      if (!batch || writing.current.has(ref)) return

      clearTimer(timers.current, ref)
      writing.current.add(ref)

      // Le lot n'est pas vidé avant l'écriture. Le vider ferait retomber
      // l'affichage sur la ligne `media_state`, qui ne porte pas encore les
      // taps en cours : la barre reculerait le temps d'un aller-retour.
      const written = batch.taps

      try {
        const stored = await events.eventsForMedia(ref)
        const previous = progress(stored)
        const projected = applyTaps(
          { percent: previous.percent, label: previous.label },
          written,
          batch.increment,
        )

        const produced = advanceProgress(
          { events: stored, mediaRef: ref, clock: systemClock, ids: uuidv7Generator, deviceId },
          {
            increment: written * batch.increment,
            ...(projected.label === null ? {} : { label: projected.label }),
          },
        )

        if (produced.length > 0) await events.append(produced as never)
      } finally {
        writing.current.delete(ref)
        settle(batches.current, ref, written)
        render()
      }

      // Des taps sont arrivés pendant l'écriture : ils forment le lot suivant.
      if (batches.current.has(ref)) arm(timers.current, ref, flushRef.current)
    },
    [events],
  )

  // La minuterie appelle la version courante de `flush` et non celle capturée
  // au moment où elle a été armée.
  const flushRef = useRef(flush)
  flushRef.current = flush

  const tap = useCallback(
    (ref: MediaRef, increment: number) => {
      const existing = batches.current.get(ref)
      batches.current.set(ref, {
        taps: (existing?.taps ?? 0) + 1,
        // L'incrément de la rafale en cours ne change pas en cours de route :
        // il vient de `number_of_episodes`, qu'un complètement de cache
        // pourrait renseigner entre deux taps. Changer la valeur d'un tap
        // déjà encaissé ferait sauter la barre sous les doigts.
        increment: existing?.increment ?? increment,
      })

      arm(timers.current, ref, flushRef.current)
      render()
    },
    [],
  )

  /** Taps encaissés et pas encore écrits, pour l'affichage optimiste. */
  const pendingTaps = useCallback((ref: MediaRef) => batches.current.get(ref)?.taps ?? 0, [])

  // Écritures « marquer vu » en vol, pour ignorer un double-tap. Un `Set`
  // et non un booléen : deux médias distincts peuvent se marquer en même
  // temps, et l'un ne doit pas bloquer l'autre.
  const completing = useRef(new Set<MediaRef>())

  /**
   * Marque le média vu, en un tap — la moitié « film » du play adaptatif.
   *
   * Sur un média sans épisodes, une progression n'a pas de sens : le tap
   * exprime « je l'ai vu », donc il écrit un `SEEN` via `setStatus`, pas un
   * `PROG`. Pas de regroupement ni de minuterie ici : il n'y a rien à
   * regrouper, un film ne se finit qu'une fois par cycle.
   *
   * Le double-tap est absorbé deux fois : le garde en vol ignore le second
   * tap d'une rafale, et `setStatus` relit le journal au moment d'écrire —
   * un tap arrivé après l'écriture ne produit rien, le statut est déjà vu.
   */
  const markSeen = useCallback(
    async (ref: MediaRef): Promise<void> => {
      if (completing.current.has(ref)) return
      completing.current.add(ref)

      try {
        const stored = await events.eventsForMedia(ref)
        const produced = setStatus(
          { events: stored, mediaRef: ref, clock: systemClock, ids: uuidv7Generator, deviceId },
          'seen',
        )

        if (produced.length > 0) await events.append(produced as never)
      } finally {
        completing.current.delete(ref)
      }
    },
    [events, deviceId],
  )

  // Écritures « commencer » en vol, même raison que `completing` : ignorer
  // le double-tap sans qu'un média n'en bloque un autre.
  const starting = useRef(new Set<MediaRef>())

  /**
   * Fait passer le média « en cours », en un tap — le play d'un titre à voir.
   *
   * C'est le geste du ▶ discret sur l'étagère « À VOIR » : un tap ouvre un
   * cycle (`START`), série comme film — un film ouvert se marquera vu plus
   * tard, d'un tap sur le play de la rangée « EN COURS ». Pas de regroupement
   * ni de minuterie : on ne commence un cycle qu'une fois.
   *
   * Même double protection que `markSeen` : le garde en vol absorbe le second
   * tap d'une rafale, et `setStatus` relit le journal au moment d'écrire —
   * un tap arrivé après l'écriture ne produit rien, le statut est déjà
   * « en cours ».
   */
  const startWatching = useCallback(
    async (ref: MediaRef): Promise<void> => {
      if (starting.current.has(ref)) return
      starting.current.add(ref)

      try {
        const stored = await events.eventsForMedia(ref)
        const produced = setStatus(
          { events: stored, mediaRef: ref, clock: systemClock, ids: uuidv7Generator, deviceId },
          'watching',
        )

        if (produced.length > 0) await events.append(produced as never)
      } finally {
        starting.current.delete(ref)
      }
    },
    [events, deviceId],
  )

  /**
   * Écrit tout ce qui traîne quand la page part en arrière-plan.
   *
   * `visibilitychange` couvre le passage en arrière-plan, `pagehide` couvre
   * la fermeture — et sur iOS, où une PWA est tuée sans préavis, c'est
   * `pagehide` qui arrive, pas `beforeunload`. Sans les deux, la dernière
   * rafale de la soirée est perdue.
   */
  useEffect(() => {
    const flushAll = () => {
      for (const ref of [...batches.current.keys()]) void flushRef.current(ref)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flushAll)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushAll)
      flushAll()
    }
  }, [])

  return { tap, pendingTaps, markSeen, startWatching }
}

function arm(
  timers: Map<MediaRef, ReturnType<typeof setTimeout>>,
  ref: MediaRef,
  flush: (ref: MediaRef) => Promise<void>,
): void {
  clearTimer(timers, ref)
  timers.set(
    ref,
    setTimeout(() => {
      timers.delete(ref)
      void flush(ref)
    }, IDLE_BEFORE_WRITE),
  )
}

function clearTimer(
  timers: Map<MediaRef, ReturnType<typeof setTimeout>>,
  ref: MediaRef,
): void {
  const existing = timers.get(ref)
  if (existing === undefined) return
  clearTimeout(existing)
  timers.delete(ref)
}

/**
 * Retire du lot les taps qui viennent d'être écrits.
 *
 * Retirer plutôt que vider : des taps ont pu arriver pendant l'écriture, et
 * les jeter perdrait des épisodes que l'utilisateur a vus avancer à l'écran.
 */
function settle(batches: Map<MediaRef, Batch>, ref: MediaRef, written: number): void {
  const current = batches.get(ref)
  if (!current) return

  if (current.taps <= written) {
    batches.delete(ref)
    return
  }

  batches.set(ref, { ...current, taps: current.taps - written })
}
