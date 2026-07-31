import { useCallback, useState } from 'react'

import type { SearchHit } from '@owlog/contracts'

import { systemClock, uuidv7Generator } from '@/adapters/browser/clock'
import { backdate, type BackdateEntry } from '@/domain/commands'
import { applyVoids } from '@/domain/reducers/applyVoids'
import { cycles } from '@/domain/rules/cycles'
import type { DomainEvent } from '@/domain/types'
import { partialCacheRow } from '@/ports/MediaCache'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Saisie d'un visionnage passé.
 *
 * Le domaine fait tout le travail : `backdate` décide seul si la saisie clôt
 * un visionnage déjà ouvert ou en minte un neuf. Ce hook ne fait que deux
 * choses en plus — écrire, et **relire ce que la règle a décidé**.
 *
 * Ce second point n'est pas cosmétique. La règle de rattachement est la plus
 * délicate du modèle, et l'utilisateur qui saisit vingt souvenirs doit
 * pouvoir lui faire confiance sans ouvrir le journal à chaque fois. Un écran
 * qui dit seulement « enregistré » l'obligerait à vérifier ; c'est
 * exactement ce que le critère de l'étape refuse.
 */
export type BackdateOutcome = {
  /** `attached` : le `SEEN` a clos un visionnage déjà ouvert. */
  readonly kind: 'attached' | 'created'
  /** Rang du visionnage concerné, celui qu'affiche le journal. */
  readonly number: number
}

export function useBackdate() {
  const { events, deviceId } = usePorts()

  const [target, setTarget] = useState<SearchHit | null>(null)
  const [outcome, setOutcome] = useState<BackdateOutcome | null>(null)
  const [saving, setSaving] = useState(false)
  /** Titres logués depuis l'ouverture de l'app. Donne son rythme à la session. */
  const [logged, setLogged] = useState(0)

  const open = useCallback((hit: SearchHit) => {
    setTarget(hit)
    setOutcome(null)
  }, [])

  const close = useCallback(() => {
    setTarget(null)
    setOutcome(null)
  }, [])

  /** Garde le titre, efface la confirmation : on enchaîne sur le même média. */
  const again = useCallback(() => setOutcome(null), [])

  const save = useCallback(
    async (entry: BackdateEntry) => {
      if (!target) return
      setSaving(true)

      try {
        // Lecture ponctuelle et non réactive : la feuille s'ouvre sur un
        // résultat de recherche quelconque, pas sur un média monté.
        const existing = await events.eventsForMedia(target.ref)

        const produced = backdate(
          {
            events: existing,
            mediaRef: target.ref,
            clock: systemClock,
            ids: uuidv7Generator,
            deviceId,
          },
          entry,
        )

        await events.append(produced, {
          cacheRows: [partialCacheRow(target, systemClock.now())],
        })

        setOutcome(readOutcome(existing, produced))
        setLogged((count) => count + 1)
      } finally {
        setSaving(false)
      }
    },
    [events, target],
  )

  return { target, outcome, saving, logged, open, close, again, save }
}

/**
 * Relit la décision du domaine dans les événements qu'il a produits.
 *
 * Un événement d'ouverture dans le lot signifie que la commande a minté un
 * cycle ; son absence signifie qu'elle s'est rattachée à un cycle déjà
 * ouvert. Le rang vient de `cycles()`, la seule définition du projet — le
 * recalculer ici ferait une deuxième règle, qui divergerait en silence.
 */
function readOutcome(
  existing: readonly DomainEvent[] | readonly { readonly type: string }[],
  produced: readonly DomainEvent[],
): BackdateOutcome {
  const opening = produced.find((e) => e.type === 'START' || e.type === 'REWATCH')
  const seen = produced.find((e) => e.type === 'SEEN')

  const all = cycles(applyVoids([...(existing as readonly DomainEvent[]), ...produced]))
  const rank = all.find((cycle) => cycle.key === seen?.cycle_key)?.rank ?? all.length

  return { kind: opening ? 'created' : 'attached', number: rank }
}
