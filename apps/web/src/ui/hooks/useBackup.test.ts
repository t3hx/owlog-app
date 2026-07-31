import { describe, expect, it } from 'vitest'

import { format } from '@/domain/export/format'
import type { SettingKey, SettingsStore } from '@/ports/SettingsStore'
import { BACKED_UP, readSettings } from '@/ui/hooks/useBackup'

/**
 * Pureté du `.log`.
 *
 * Le fichier se réimporte sur un autre appareil — c'est même son rôle. Ce
 * qui identifie CETTE installation ne doit donc jamais y entrer :
 *
 * - `deviceId` importé : deux installations passent pour une seule ;
 * - `syncCursor` importé : l'appareil croit avoir déjà tiré ce qu'il n'a
 *   jamais vu — des événements distants invisibles pour toujours, sans un
 *   bruit. C'est le pire genre de panne : celle qui ne se voit pas.
 *
 * Le verrou est la liste `BACKED_UP` : l'export ne lit qu'elle, l'import
 * n'applique qu'elle. Ces tests la scellent dans les deux sens.
 */
function storeWith(values: Partial<Record<SettingKey, string>>): SettingsStore {
  return {
    read: (key) => Promise.resolve(values[key]),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    subscribe: () => () => undefined,
  }
}

describe('pureté du .log', () => {
  it('la liste des réglages sauvegardés exclut l’identité et les curseurs de sync', () => {
    expect(BACKED_UP).not.toContain('deviceId')
    expect(BACKED_UP).not.toContain('syncCursor')
    expect(BACKED_UP).not.toContain('syncCacheCursor')
  })

  it('l’export ne lit que la liste, même quand la sync a tout rempli', async () => {
    const settings = storeWith({
      firstName: 'Alex',
      deviceId: '01920000-0000-7000-8000-00000000abcd',
      syncCursor: '4200',
      syncCacheCursor: '77',
    })

    const exported = await readSettings(settings)

    expect([...exported.keys()]).toEqual(['firstName'])
  })

  it('le fichier rendu ne contient ni identifiant d’appareil ni curseur', async () => {
    const settings = storeWith({
      firstName: 'Alex',
      deviceId: '01920000-0000-7000-8000-00000000abcd',
      syncCursor: '4200',
    })

    const text = format([], new Map(), '2026-07-31T00:00:00.000Z', await readSettings(settings))

    expect(text).toContain('firstName')
    expect(text).not.toContain('deviceId')
    expect(text).not.toContain('syncCursor')
    expect(text).not.toContain('4200')
  })
})
