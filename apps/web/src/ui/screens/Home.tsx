import { useTranslation } from 'react-i18next'

import { homeCounters } from '@/domain/reducers/mediaState'
import { Search } from '@/ui/components/search/Search'
import { UnderConstruction } from '@/ui/components/UnderConstruction'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Accueil.
 *
 * Les sections `▸ EN COURS` et `▸ À VOIR` — vignettes, barre de progression,
 * bouton play — arrivent à l'étape 8.
 *
 * Les compteurs, eux, sont déjà branchés sur le store. Ils l'ont d'abord été
 * en dur à `0`, et c'était le pire des deux mondes : tant qu'aucun écran ne
 * montre la bibliothèque, cette ligne est le seul retour visible après un
 * ajout, et elle affirmait qu'il ne s'était rien passé. Un placeholder qui se
 * tait laisse deviner qu'il est vide ; un compteur faux fait diagnostiquer
 * une perte de données qui n'existe pas.
 */
export function Home({ firstName }: { firstName: string }) {
  const { t } = useTranslation()
  const { live } = usePorts()
  const counters = homeCounters(live.useMediaStates())

  return (
    <div className="mx-auto flex max-w-md flex-col gap-1 pt-6">
      <Search context="add">
        <div className="px-5 pt-2">
          <h1 className="font-display text-[25px] font-semibold text-text">
            {t('home.greeting', { firstName })}
          </h1>
          <p className="font-mono text-[11px] text-muted">
            {t('home.counters', counters)}
          </p>

          <UnderConstruction
            title={t('home.watchingTitle')}
            step={8}
            what={t('home.watchingWhat')}
          />
        </div>
      </Search>
    </div>
  )
}
