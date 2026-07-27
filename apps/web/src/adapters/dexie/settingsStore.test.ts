import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { creerSettingsStore } from '@/adapters/dexie/settingsStore'

/**
 * Contrat du port SettingsStore.
 *
 * Ces tests tournent contre le vrai Dexie via `fake-indexeddb`, pas contre
 * un double. C'est le seul moyen de vérifier ce qui compte réellement ici :
 * qu'un réglage survit à la fermeture de l'onglet. Un double en mémoire
 * passerait au vert en ne prouvant rien.
 */
describe('SettingsStore (adaptateur Dexie)', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })

  it('rend undefined pour une clé jamais écrite', async () => {
    const store = creerSettingsStore()

    await expect(store.lire('prenom')).resolves.toBeUndefined()
  })

  it('relit la valeur écrite', async () => {
    const store = creerSettingsStore()

    await store.ecrire('prenom', 'Tx')

    await expect(store.lire('prenom')).resolves.toBe('Tx')
  })

  it('écrase la valeur précédente', async () => {
    const store = creerSettingsStore()

    await store.ecrire('prenom', 'Tx')
    await store.ecrire('prenom', 'Alex')

    await expect(store.lire('prenom')).resolves.toBe('Alex')
  })

  it('survit à une nouvelle instance du store', async () => {
    await creerSettingsStore().ecrire('prenom', 'Tx')

    // Une nouvelle instance représente le rechargement de l'application :
    // rien ne doit vivre en mémoire dans l'adaptateur.
    await expect(creerSettingsStore().lire('prenom')).resolves.toBe('Tx')
  })

  it('notifie les abonnés à chaque écriture', async () => {
    const store = creerSettingsStore()
    const rappel = vi.fn()

    const desabonner = store.souscrire('prenom', rappel)
    await store.ecrire('prenom', 'Tx')

    expect(rappel).toHaveBeenCalledTimes(1)

    desabonner()
    await store.ecrire('prenom', 'Alex')

    expect(rappel).toHaveBeenCalledTimes(1)
  })

  it('ne notifie pas les abonnés d\'une autre clé', async () => {
    const store = creerSettingsStore()
    const rappel = vi.fn()

    store.souscrire('prenom', rappel)
    await db.settings.put({ cle: 'autre-cle', valeur: 'x' })

    expect(rappel).not.toHaveBeenCalled()
  })
})
