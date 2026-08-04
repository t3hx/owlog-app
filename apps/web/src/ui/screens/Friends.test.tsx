import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AuthUser, FriendsResponse } from '@owlog/contracts'

import i18next from '@/i18n'
import type { SocialGateway } from '@/ports/SocialGateway'
import { PortsProvider, type Ports } from '@/ui/PortsProvider'
import { Friends } from '@/ui/screens/Friends'
import { SessionProvider } from '@/ui/session/SessionProvider'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * L'écran Amis, par ses états.
 *
 * L'écran est exempté de TDD — son contrôle est la comparaison visuelle
 * avec les mocks 9c/10e. Ce fichier ne teste donc pas des pixels mais les
 * **branchements** que la spécification impose et qu'aucune capture ne
 * montre : ce qui s'affiche sans compte, sans pseudo, sans réseau, et le
 * fait que l'état d'un bouton vienne du serveur et non du clic.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

const MEMBER: AuthUser = { email: 'a@b.c', firstName: 'Alex', pseudo: 'nyx' }

const EMPTY: FriendsResponse = { friends: [], incoming: [] }

function renderFriends(options: {
  user?: AuthUser | null
  social?: Partial<SocialGateway>
} = {}) {
  const user = options.user === undefined ? MEMBER : options.user
  const base = fakePorts({
    social: { circle: () => Promise.resolve({ ok: true, value: EMPTY }), ...options.social },
  })
  const ports: Ports = {
    ...base,
    auth: { ...base.auth, me: () => Promise.resolve({ ok: true, value: user }) },
  }

  return render(
    <PortsProvider ports={ports}>
      <SessionProvider>
        <Friends />
      </SessionProvider>
    </PortsProvider>,
  )
}

describe('écran Amis — ce qui s’affiche quand il n’y a rien', () => {
  it('invite à ouvrir un compte au lieu de rendre un onglet mort', async () => {
    renderFriends({ user: null })

    expect(await screen.findByText(/le social demande un compte/i)).toBeTruthy()
    expect(screen.getByText('ACTIVER LA SYNC')).toBeTruthy()
  })

  it('emmène à Réglages quand le pseudo manque, sans barre d’ajout', async () => {
    // Étape manquante, pas erreur : l'écran ne montre pas un message rouge,
    // il montre la porte.
    renderFriends({ user: { ...MEMBER, pseudo: null } })

    expect(await screen.findByText(/choisis d'abord un pseudo/i)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('dit son ignorance hors-ligne plutôt que d’afficher une liste périmée', async () => {
    renderFriends({
      social: { circle: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }) },
    })

    expect(await screen.findByText(/hors-ligne/i)).toBeTruthy()
  })

  it('rend l’état vide avec la barre d’ajout pour seul appel à l’action', async () => {
    renderFriends()

    expect(await screen.findByText(/ton log est meilleur à plusieurs/i)).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /ajouter par pseudo/i })).toBeTruthy()
  })

  it('masque la section des demandes à zéro', async () => {
    renderFriends()

    await screen.findByText(/ton log est meilleur/i)
    expect(screen.queryByText(/DEMANDES/)).toBeNull()
  })
})

describe('écran Amis — recherche et demande', () => {
  async function searchFor(pseudo: string, social: Partial<SocialGateway>) {
    renderFriends({ social })
    const field = await screen.findByRole('textbox', { name: /ajouter par pseudo/i })
    fireEvent.change(field, { target: { value: pseudo } })
    fireEvent.submit(field)
    return field
  }

  it('rend le même encart pour un pseudo inconnu et un pseudo mal écrit', async () => {
    await searchFor('personne', {
      search: () => Promise.resolve({ ok: false, failure: { kind: 'notFound' } }),
    })

    expect(await screen.findByText(/aucun compte à ce pseudo/i)).toBeTruthy()
  })

  it('force les minuscules à la saisie', async () => {
    const search = vi.fn(() => Promise.resolve({ ok: false as const, failure: { kind: 'notFound' as const } }))
    await searchFor('NoVa', { search })

    expect(search).toHaveBeenCalledWith('nova')
  })

  it('l’état du bouton vient du serveur, pas du clic', async () => {
    // Le serveur peut répondre `friend` à une demande — c'est le cas des
    // demandes croisées. Un bouton qui passerait à « demande envoyée » de
    // lui-même mentirait jusqu'au prochain rechargement.
    await searchFor('nova', {
      search: () =>
        Promise.resolve({
          ok: true,
          value: { pseudo: 'nova', memberSince: '2025-01-02T00:00:00.000Z', relation: 'none' },
        }),
      request: () => Promise.resolve({ ok: true, value: 'friend' }),
    })

    fireEvent.click(await screen.findByRole('button', { name: '+ AJOUTER' }))

    expect(await screen.findByText('voir ›')).toBeTruthy()
    expect(screen.queryByText('demande envoyée')).toBeNull()
  })

  it('n’offre pas d’ajouter quand la demande est déjà partie', async () => {
    await searchFor('nova', {
      search: () =>
        Promise.resolve({
          ok: true,
          value: {
            pseudo: 'nova',
            memberSince: '2025-01-02T00:00:00.000Z',
            relation: 'request-sent',
          },
        }),
    })

    expect(await screen.findByText('demande envoyée')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '+ AJOUTER' })).toBeNull()
  })
})

describe('écran Amis — les deux listes', () => {
  const FULL: FriendsResponse = {
    friends: [
      {
        pseudo: 'nova',
        memberSince: '2025-01-02T00:00:00.000Z',
        relation: 'friend',
        friendsSince: '2026-07-01T00:00:00.000Z',
        activity: {
          ref: 'tmdb:tv/95396',
          type: 'START',
          title: 'Severance',
          at: '2026-08-03T20:00:00.000Z',
        },
        compat: 87,
      },
      {
        pseudo: 'theo',
        memberSince: '2025-03-02T00:00:00.000Z',
        relation: 'friend',
        friendsSince: '2026-06-01T00:00:00.000Z',
        activity: null,
        compat: null,
      },
    ],
    incoming: [
      {
        pseudo: 'mira',
        memberSince: '2025-05-05T00:00:00.000Z',
        relation: 'request-received',
        requestedAt: '2026-08-03T10:00:00.000Z',
      },
    ],
  }

  it('nomme l’activité avec le vocabulaire du LOG, jamais un second', async () => {
    renderFriends({ social: { circle: () => Promise.resolve({ ok: true, value: FULL }) } })

    expect(await screen.findByText('commencé')).toBeTruthy()
    expect(screen.getByText('Severance')).toBeTruthy()
  })

  it('affiche « compat — » et non « 0 % » quand rien ne se recoupe', async () => {
    renderFriends({ social: { circle: () => Promise.resolve({ ok: true, value: FULL }) } })

    expect(await screen.findByText('compat —')).toBeTruthy()
    expect(screen.getByText('compat 87%')).toBeTruthy()
  })

  it('recharge les deux listes après une réponse à une demande', async () => {
    // Accepter change deux listes à la fois : la demande quitte l'une,
    // l'ami entre dans l'autre. Recalculer localement dupliquerait la règle
    // du serveur — et se tromperait sur une demande croisée.
    const circle = vi.fn(() => Promise.resolve({ ok: true as const, value: FULL }))
    const accept = vi.fn(() => Promise.resolve({ ok: true as const, value: 'friend' as const }))
    renderFriends({ social: { circle, accept } })

    fireEvent.click(await screen.findByRole('button', { name: 'accepter' }))

    expect(accept).toHaveBeenCalledWith('mira')
    await vi.waitFor(() => expect(circle).toHaveBeenCalledTimes(2))
  })
})
