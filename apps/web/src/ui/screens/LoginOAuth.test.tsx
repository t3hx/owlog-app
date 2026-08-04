import { render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18next from '@/i18n'
import type { AuthGateway } from '@/ports/AuthGateway'
import { PortsProvider, type Ports } from '@/ui/PortsProvider'
import { Login } from '@/ui/screens/Login'
import { LoginOAuth } from '@/ui/screens/LoginOAuth'
import { SessionProvider } from '@/ui/session/SessionProvider'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * Connexion par fournisseur, côté écran.
 *
 * Trois branchements que ni le prototype ni une capture ne montrent :
 * l'absence de bouton quand le serveur n'offre rien, l'échange qui ne part
 * qu'une fois — un code d'autorisation est à usage unique et `StrictMode`
 * monte deux fois — et le message du cas « e-mail non vérifié », qui doit
 * dire quoi faire au lieu de « recommence ».
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

beforeEach(() => {
  window.history.replaceState(null, '', '/login/oauth/google?code=abc&state=xyz')
})

function withPorts(auth: Partial<AuthGateway>, children: React.ReactNode) {
  const base = fakePorts({ auth })
  const ports: Ports = { ...base }

  return render(
    <PortsProvider ports={ports}>
      <SessionProvider>{children}</SessionProvider>
    </PortsProvider>,
  )
}

describe('boutons de fournisseur', () => {
  it('ne rend rien quand le serveur n’offre aucun fournisseur', async () => {
    // Dégradation douce : sans secrets, la card se re-centre sur l'e-mail.
    withPorts({ oauthProviders: () => Promise.resolve({ ok: true, value: [] }) }, <Login />)

    expect(await screen.findByPlaceholderText(/e-mail|email/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /continuer avec/i })).toBeNull()
  })

  it('rend Google puis GitHub, dans cet ordre', async () => {
    withPorts(
      { oauthProviders: () => Promise.resolve({ ok: true, value: ['google', 'github'] }) },
      <Login />,
    )

    const buttons = await screen.findAllByRole('button', { name: /continuer avec/i })
    expect(buttons.map((button) => button.textContent)).toEqual([
      'continuer avec Google',
      'continuer avec GitHub',
    ])
  })
})

describe('retour du fournisseur', () => {
  it('n’échange le code qu’une seule fois', async () => {
    // Un code d'autorisation est à usage unique : un second envoi
    // échouerait et effacerait une connexion réussie par un message
    // d'erreur.
    const oauthComplete = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { email: 'a@b.c', firstName: null, pseudo: null },
      }),
    )
    withPorts({ oauthComplete }, <LoginOAuth provider="google" />)

    await vi.waitFor(() => expect(oauthComplete).toHaveBeenCalledTimes(1))
    expect(oauthComplete).toHaveBeenCalledWith('google', { code: 'abc', state: 'xyz' })
  })

  it('renvoie en phase e-mail avec le motif, sans page de refus', async () => {
    // `social.md` §5 : retour phase e-mail avec encart d'erreur système.
    // Une page de refus dédiée offrirait un second endroit où lire la même
    // erreur, avec un geste manuel de plus pour en sortir.
    withPorts(
      {
        oauthComplete: () =>
          Promise.resolve({ ok: false, failure: { kind: 'oauth-unverified-email' } }),
      },
      <LoginOAuth provider="google" />,
    )

    await vi.waitFor(() =>
      expect(window.location.pathname + window.location.search).toBe(
        '/login?oauth=unverified',
      ),
    )
  })

  it('n’échange rien quand le fournisseur a refusé avant de rendre un code', async () => {
    window.history.replaceState(null, '', '/login/oauth/google?error=access_denied')
    const oauthComplete = vi.fn()

    withPorts({ oauthComplete }, <LoginOAuth provider="google" />)

    await vi.waitFor(() => expect(window.location.search).toBe('?oauth=refused'))
    expect(oauthComplete).not.toHaveBeenCalled()
  })

  it('n’échange rien pour un fournisseur inconnu', async () => {
    const oauthComplete = vi.fn()

    withPorts({ oauthComplete }, <LoginOAuth provider="myspace" />)

    await vi.waitFor(() => expect(window.location.search).toBe('?oauth=refused'))
    expect(oauthComplete).not.toHaveBeenCalled()
  })

  it('rend l’encart d’erreur sur la card de connexion, message d’action compris', async () => {
    window.history.replaceState(null, '', '/login?oauth=unverified')

    withPorts({}, <Login />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/vérifie-la chez lui/i)
  })
})
