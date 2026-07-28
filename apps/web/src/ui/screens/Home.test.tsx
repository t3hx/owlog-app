import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { mediaState, type MediaStateRow } from '@/domain/reducers/mediaState'
import { createFactory, MOVIE, SERIES } from '@/domain/test/factory'
import i18next from '@/i18n'
import { PortsProvider } from '@/ui/PortsProvider'
import { Home } from '@/ui/screens/Home'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * La langue est forcée : le détecteur lit `navigator.language`, qui vaut
 * `en-US` sous jsdom. Sans ça le rendu part en anglais, les assertions
 * françaises échouent, et l'échec ressemble à un défaut des compteurs alors
 * qu'il ne dit rien d'eux.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

/**
 * Compteurs de l'accueil.
 *
 * Ce test existe à cause d'un défaut réel : les compteurs ont été écrits en
 * dur à `0` en attendant les sections de l'étape 8. Tant qu'aucun écran ne
 * montre la bibliothèque, cette ligne est le **seul** retour visible après un
 * ajout — et un `0` faux fait diagnostiquer une perte de données qui n'existe
 * pas. Un placeholder qui se tait est honnête ; un compteur faux ne l'est pas.
 *
 * L'assertion porte donc sur des nombres non nuls et distincts entre eux : un
 * retour aux valeurs en dur, ou une inversion des deux compteurs, échoue ici.
 */
function renderHome(mediaStates: readonly MediaStateRow[]) {
  return render(
    <PortsProvider ports={fakePorts({ mediaStates })}>
      <Home firstName="Tx" />
    </PortsProvider>,
  )
}

describe('compteurs de l accueil', () => {
  it('compte les titres du store, pas des zeros en dur', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    const states = [
      mediaState([f1.watch(), f1.start('c1')], MOVIE),
      mediaState([f2.watch()], SERIES),
    ]

    renderHome(states)

    expect(screen.getByText('› 1 en cours · 1 à voir')).toBeDefined()
  })

  it('ne confond pas en cours et a voir', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    // Deux « à voir » pour un « en cours » : si les deux compteurs sont
    // intervertis, le rendu dit « 2 en cours · 1 à voir » et le test tombe.
    const states = [
      mediaState([f1.watch(), f1.start('c1')], MOVIE),
      mediaState([f2.watch()], SERIES),
      mediaState([createFactory('tmdb:movie/603').watch()], 'tmdb:movie/603'),
    ]

    renderHome(states)

    expect(screen.getByText('› 1 en cours · 2 à voir')).toBeDefined()
  })

  it('rend zero quand la bibliotheque est vide', () => {
    renderHome([])

    expect(screen.getByText('› 0 en cours · 0 à voir')).toBeDefined()
  })
})
