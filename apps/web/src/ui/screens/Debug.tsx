import { useCallback, useEffect, useState } from 'react'

import { metriques, type Metriques } from '@/domain/reducers/metriques'
import type { EvenementStocke, MediaRef } from '@/domain/types'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Écran de diagnostic.
 *
 * Volontairement non stylé : il n'est pas dans le handoff, il ne sera
 * jamais montré à personne, et lui donner l'apparence du reste de l'app
 * ferait croire qu'il en fait partie.
 *
 * Il répond à trois questions qu'aucun autre écran ne pose :
 *
 * 1. **Le moment fort a-t-il jamais été déclenché ?** Si les visionnages
 *    au-delà du premier restent à zéro après deux semaines, le produit
 *    livré n'est qu'une watchlist de plus.
 * 2. **Une version du client a-t-elle déposé des données qu'une autre ne
 *    lit pas ?** Les réducteurs ignorent silencieusement les types
 *    inconnus ; sans ce compteur, « ignorer » voudrait dire « perdre ».
 * 3. **La table dérivée est-elle réparable ?** Le bouton de reconstruction
 *    est le chemin de réparation, pas un utilitaire de confort.
 */
export function Debug() {
  const { events } = usePorts()
  const [mesures, setMesures] = useState<Metriques | null>(null)
  const [reconstruction, setReconstruction] = useState<'inactif' | 'en-cours' | 'fait'>(
    'inactif',
  )

  const mesurer = useCallback(async () => {
    const etats = await events.allMediaStates()
    const parMedia = new Map<MediaRef, readonly EvenementStocke[]>()

    for (const etat of etats) {
      parMedia.set(etat.ref, await events.eventsForMedia(etat.ref))
    }

    setMesures(metriques(parMedia))
  }, [events])

  useEffect(() => {
    void mesurer()
  }, [mesurer])

  async function reconstruire() {
    setReconstruction('en-cours')
    await events.rebuildAllState()
    await mesurer()
    setReconstruction('fait')
  }

  return (
    <div className="mx-auto max-w-md px-5 py-8 font-mono text-xs text-muted">
      <h1 className="mb-4 text-sm text-text">/debug</h1>

      {mesures === null ? (
        <p>mesure…</p>
      ) : (
        <dl className="space-y-1">
          <Mesure nom="medias" valeur={mesures.medias} />
          <Mesure
            nom="cycles_ouverts_au_dela_du_premier"
            valeur={mesures.cyclesAuDelaDuPremier}
            alerte={mesures.cyclesAuDelaDuPremier === 0 && mesures.medias > 0}
          />
          <Mesure nom="entrees_de_journal" valeur={mesures.entreesDeJournal} />
          <Mesure nom="entrees_de_journal_par_jour" valeur={mesures.entreesParJour} />
          <Mesure nom="evenements_annules" valeur={mesures.evenementsAnnules} />
          <Mesure
            nom="evenements_de_type_inconnu"
            valeur={mesures.evenementsInconnus.reduce((total, e) => total + e.nombre, 0)}
            alerte={mesures.evenementsInconnus.length > 0}
          />
          {mesures.evenementsInconnus.map((inconnu) => (
            <Mesure
              key={inconnu.type}
              nom={`  └ ${inconnu.type}`}
              valeur={inconnu.nombre}
            />
          ))}
        </dl>
      )}

      <button
        type="button"
        onClick={() => void reconstruire()}
        disabled={reconstruction === 'en-cours'}
        className="mt-6 rounded-action border border-border px-3 py-2 text-left text-[11px] text-text disabled:opacity-40"
      >
        {reconstruction === 'en-cours'
          ? 'reconstruction…'
          : 'reconstruire media_state depuis les evenements'}
      </button>

      {reconstruction === 'fait' && <p className="mt-2 text-accent">reconstruit.</p>}

      <p className="mt-6 leading-relaxed text-subtle">
        media_state est derivee : la reconstruire ne perd aucune donnee.
        events est la source de verite et n&apos;est jamais modifiee.
      </p>
    </div>
  )
}

function Mesure({
  nom,
  valeur,
  alerte = false,
}: {
  nom: string
  valeur: number
  alerte?: boolean
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="whitespace-pre">{nom}</dt>
      <dd className={alerte ? 'text-status-watch' : 'text-text'}>{valeur}</dd>
    </div>
  )
}
