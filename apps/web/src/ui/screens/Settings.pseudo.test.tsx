import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import type { AuthUser } from '@owlog/contracts'

import i18next from '@/i18n'
import type { AuthFailure, ProfilePatch } from '@/ports/AuthGateway'
import { PortsProvider, type Ports } from '@/ui/PortsProvider'
import { Settings } from '@/ui/screens/Settings'
import { SessionProvider } from '@/ui/session/SessionProvider'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * La rangée pseudo de `▸ PROFIL`.
 *
 * L'écran est exempté de TDD — son contrôle est la comparaison visuelle
 * avec le prototype. Ce fichier ne teste donc pas des pixels mais le
 * **branchement** que la rangée porte : trois erreurs distinctes, une casse
 * forcée, et le fait que ce qui s'affiche vienne du serveur et non de la
 * saisie. Rien de tout cela ne se voit sur une capture.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

const MEMBER: AuthUser = { email: 'a@b.c', firstName: 'Alex', pseudo: null }

function renderSettings(options: {
  user?: AuthUser | null
  updateProfile?: (patch: ProfilePatch) => Promise<
    { ok: true; value: AuthUser } | { ok: false; failure: AuthFailure }
  >
}) {
  const base = fakePorts()
  const user = options.user === undefined ? MEMBER : options.user
  const ports: Ports = {
    ...base,
    auth: {
      ...base.auth,
      me: () => Promise.resolve({ ok: true, value: user }),
      ...(options.updateProfile ? { updateProfile: options.updateProfile } : {}),
    },
  }

  return render(
    <PortsProvider ports={ports}>
      <SessionProvider>
        <Settings />
      </SessionProvider>
    </PortsProvider>,
  )
}

/** Ouvre la rangée pseudo en édition et rend son champ. */
async function openPseudoField(): Promise<HTMLElement> {
  const row = await screen.findByRole('button', { name: /pseudo/i })
  fireEvent.click(row)
  return screen.getByRole('textbox', { name: 'pseudo' })
}

describe('rangée pseudo', () => {
  it('explique sans session au lieu de disparaitre', async () => {
    // Doctrine du projet (`social.md`) : le social exige un compte, mais la
    // surface n est jamais morte — elle explique. Masquer la rangee produit
    // la confusion qu on cherche a eviter : on cherche un reglage annonce,
    // on ne le trouve pas, et rien ne dit pourquoi.
    renderSettings({ user: null })

    const row = await screen.findByRole('button', { name: /pseudo/i })
    expect(screen.queryByText(/demande un compte/)).toBeNull()

    fireEvent.click(row)

    expect(await screen.findByText(/demande un compte/)).toBeTruthy()
    // Et le champ ne s ouvre pas : il n y a rien a reserver sans serveur.
    expect(screen.queryByRole('textbox', { name: 'pseudo' })).toBeNull()
  })

  it('affiche un tiret tant qu aucun pseudo n est pose', async () => {
    renderSettings({})

    // Portee a la rangee : `prenom` rend lui aussi un tiret quand il est vide.
    const row = await screen.findByRole('button', { name: /pseudo/i })
    expect(row.textContent).toContain('—')
  })

  it('n annonce pas « demande un compte » avant de savoir', async () => {
    // Pendant que /auth/me repond, `session.user` vaut null sans que cela
    // signifie « pas de compte ». Annoncer l absence de session a ce
    // moment-la la ferait clignoter chez tout utilisateur connecte.
    renderSettings({})

    expect(screen.queryByText(/demande un compte/)).toBeNull()
    await screen.findByRole('button', { name: /pseudo/i })
    expect(screen.queryByText(/demande un compte/)).toBeNull()
  })

  it('force les minuscules a la frappe', async () => {
    renderSettings({})
    const field = await openPseudoField()

    fireEvent.change(field, { target: { value: 'NyX_42' } })

    expect((field as HTMLInputElement).value).toBe('nyx_42')
  })

  it('affiche ce que le serveur a rendu, pas la saisie', async () => {
    renderSettings({
      updateProfile: () =>
        Promise.resolve({
          ok: true,
          // Le serveur renvoie autre chose que la saisie : c'est lui qui
          // fait autorité, et la rangée doit le montrer.
          value: { email: 'a@b.c', firstName: 'Alex', pseudo: 'nyx_normalise' },
        }),
    })
    const field = await openPseudoField()

    fireEvent.change(field, { target: { value: 'nyx_42' } })
    fireEvent.submit(field.closest('form')!)

    expect(await screen.findByText('@nyx_normalise')).toBeTruthy()
  })

  it('refuse un pseudo hors format sans appeler le serveur', async () => {
    let called = 0
    renderSettings({
      updateProfile: () => {
        called += 1
        return Promise.resolve({ ok: true, value: MEMBER })
      },
    })
    const field = await openPseudoField()

    fireEvent.change(field, { target: { value: 'ab' } })
    fireEvent.submit(field.closest('form')!)

    expect(await screen.findByText(/3 à 20 caractères/)).toBeTruthy()
    expect(called).toBe(0)
  })

  it('rend l erreur du serveur sous le champ quand le pseudo est pris', async () => {
    renderSettings({
      updateProfile: () => Promise.resolve({ ok: false, failure: { kind: 'pseudo-taken' } }),
    })
    const field = await openPseudoField()

    fireEvent.change(field, { target: { value: 'nyx_42' } })
    fireEvent.submit(field.closest('form')!)

    expect(await screen.findByText(/déjà pris/)).toBeTruthy()
    // Le champ reste ouvert sur sa saisie : l'utilisateur en corrige une
    // lettre plutôt que de tout retaper.
    expect((field as HTMLInputElement).value).toBe('nyx_42')
  })

  it('distingue un echec reseau d un pseudo pris', async () => {
    renderSettings({
      updateProfile: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    })
    const field = await openPseudoField()

    fireEvent.change(field, { target: { value: 'nyx_42' } })
    fireEvent.submit(field.closest('form')!)

    expect(await screen.findByText(/joindre le serveur/)).toBeTruthy()
  })
})
