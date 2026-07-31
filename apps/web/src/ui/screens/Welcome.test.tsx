import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import i18next from '@/i18n'
import { PortsProvider, type Ports } from '@/ui/PortsProvider'
import { Welcome } from '@/ui/screens/Welcome'
import { SessionProvider } from '@/ui/session/SessionProvider'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * Écran de première ouverture.
 *
 * Deux comportements comptent : la réponse de l'unique question atterrit
 * dans `settings` (nettoyée — un prénom entouré d'espaces n'est pas un
 * autre prénom), et si une session existe déjà — l'appareil vierge qui
 * vient de se connecter — la même réponse vaut upsert serveur, parce que
 * le serveur fait autorité sur le prénom après connexion.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

function renderWelcome(ports: Ports) {
  return render(
    <PortsProvider ports={ports}>
      <SessionProvider>
        <Welcome />
      </SessionProvider>
    </PortsProvider>,
  )
}

function submitName(name: string) {
  const field = screen.getByRole('textbox', { name: "on t'appelle comment ?" })
  fireEvent.change(field, { target: { value: name } })
  fireEvent.submit(field.closest('form')!)
}

describe('Welcome', () => {
  it('écrit le prénom nettoyé dans les réglages', async () => {
    const written: Array<[string, string]> = []
    const base = fakePorts()
    const ports: Ports = {
      ...base,
      settings: {
        ...base.settings,
        write: (key, value) => {
          written.push([key, value])
          return Promise.resolve()
        },
      },
    }

    renderWelcome(ports)
    submitName('  Alex ')

    await waitFor(() => {
      expect(written).toContainEqual(['firstName', 'Alex'])
    })
  })

  it('refuse un prénom vide — le bouton reste inerte', () => {
    renderWelcome(fakePorts())

    const submit = screen.getByRole('button', { name: 'COMMENCER' })
    expect(submit).toHaveProperty('disabled', true)
  })

  it('connecté, la réponse vaut aussi upsert serveur', async () => {
    const upserted: string[] = []
    const base = fakePorts()
    const ports: Ports = {
      ...base,
      auth: {
        ...base.auth,
        me: () =>
          Promise.resolve({ ok: true, value: { email: 'a@b.c', firstName: null } }),
        updateProfile: (firstName) => {
          upserted.push(firstName)
          return Promise.resolve({
            ok: true,
            value: { email: 'a@b.c', firstName },
          })
        },
      },
    }

    renderWelcome(ports)
    // La session se résout de façon asynchrone : attendre qu'elle soit
    // connue avant de soumettre, comme le ferait un humain.
    await waitFor(() => undefined)
    submitName('Alex')

    await waitFor(() => {
      expect(upserted).toEqual(['Alex'])
    })
  })
})
