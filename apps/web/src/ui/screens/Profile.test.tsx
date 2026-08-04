import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import type { PublicProfileView } from '@owlog/domain'

import i18next from '@/i18n'
import type { SocialGateway } from '@/ports/SocialGateway'
import { PortsProvider } from '@/ui/PortsProvider'
import { Profile } from '@/ui/screens/Profile'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * L'écran Profil, par ses états.
 *
 * Comme l'écran Amis : pas de pixels ici, mais les branchements que la
 * spécification impose. Le plus important d'entre eux ne se voit sur aucune
 * capture — un non-ami et un pseudo inconnu produisent **le même** écran.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

const BODY = {
  pseudo: 'nova',
  memberSince: '2025-01-02T00:00:00.000Z',
  loggedCount: 214,
  seenCount: 96,
  favoriteCount: 23,
  favorites: [],
  activity: [],
} as const

function renderProfile(profile: SocialGateway['profile']) {
  return render(
    <PortsProvider ports={fakePorts({ social: { profile } })}>
      <Profile pseudo="nova" />
    </PortsProvider>,
  )
}

function serve(view: PublicProfileView): SocialGateway['profile'] {
  return () => Promise.resolve({ ok: true, value: view })
}

describe('écran Profil', () => {
  it('rend les tuiles d’un ami, compat comprise', async () => {
    renderProfile(serve({ kind: 'friend', ...BODY, compat: 87 }))

    expect(await screen.findByText('@nova')).toBeTruthy()
    expect(screen.getByText('96')).toBeTruthy()
    expect(screen.getByText('87%')).toBeTruthy()
  })

  it('n’affiche aucune compat sur son propre profil', async () => {
    // La règle est portée par le type : `OwnProfile` n'a pas de champ
    // `compat`, donc aucun écran ne peut rendre la tuile par accident.
    renderProfile(serve({ kind: 'own', ...BODY }))

    expect(await screen.findByText('@nova')).toBeTruthy()
    expect(screen.queryByText('compat avec toi')).toBeNull()
  })

  it('affiche « — » et non « 0 % » quand rien ne se recoupe', async () => {
    renderProfile(serve({ kind: 'friend', ...BODY, compat: null }))

    expect(await screen.findByText('—')).toBeTruthy()
  })

  it('dit qu’il n’y a rien à raconter plutôt que de masquer la section', async () => {
    renderProfile(serve({ kind: 'friend', ...BODY, compat: 12 }))

    expect(await screen.findByText('▸ ACTIVITÉ')).toBeTruthy()
    expect(screen.getByText(/rien à raconter/i)).toBeTruthy()
  })

  it('rend « introuvable » avec une sortie, jamais un cul-de-sac', async () => {
    renderProfile(() => Promise.resolve({ ok: false, failure: { kind: 'notFound' } }))

    expect(await screen.findByText('utilisateur introuvable')).toBeTruthy()
    expect(screen.getByText('retour aux amis')).toBeTruthy()
  })

  it('distingue le hors-ligne de l’introuvable', async () => {
    // Confondre les deux ferait croire à une disparition de compte à chaque
    // passage en tunnel.
    renderProfile(() => Promise.resolve({ ok: false, failure: { kind: 'offline' } }))

    expect(await screen.findByText(/hors-ligne/i)).toBeTruthy()
    expect(screen.queryByText('utilisateur introuvable')).toBeNull()
  })
})
