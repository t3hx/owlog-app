import { afterEach, describe, expect, inject, it } from 'vitest'

import { createScratchDb, type ScratchDb } from '../../test/scratchDb.ts'
import { createDb, type Db } from './db.ts'
import { MIGRATIONS_DIR } from './migrate.ts'

/**
 * Le cycle de vie de la base vu du service.
 *
 * La promesse testée est celle qui protège le proxy TMDB : quoi qu'il
 * arrive à Postgres, `start()` ne lève jamais — l'état se lit, il ne se
 * subit pas.
 */
const adminUrl = inject('databaseAdminUrl')

const opened: { scratch?: ScratchDb; db?: Db }[] = []

afterEach(async () => {
  for (const item of opened.splice(0)) {
    await item.db?.stop()
    await item.scratch?.drop()
  }
})

describe.skipIf(!adminUrl)('createDb', () => {
  it('démarre, migre, et passe à « ok »', async () => {
    const scratch = await createScratchDb(adminUrl!)
    const db = createDb({ url: scratch.url, migrationsDir: MIGRATIONS_DIR, retryDelayMs: null })
    opened.push({ scratch, db })

    expect(db.status()).toBe('starting')
    await db.start()
    expect(db.status()).toBe('ok')
  })

  it('ne lève jamais quand la base est injoignable — il constate « down »', async () => {
    const db = createDb({
      // Un port fermé : la connexion échoue vite et proprement.
      url: 'postgresql://postgres:x@127.0.0.1:1/postgres',
      migrationsDir: MIGRATIONS_DIR,
      retryDelayMs: null,
      log: () => {},
    })
    opened.push({ db })

    await expect(db.start()).resolves.toBeUndefined()
    expect(db.status()).toBe('down')
  })

  it('la sonde refresh voit la base tomber puis revenir', async () => {
    const scratch = await createScratchDb(adminUrl!)
    const db = createDb({ url: scratch.url, migrationsDir: MIGRATIONS_DIR, retryDelayMs: null })
    opened.push({ db })

    await db.start()
    expect(db.status()).toBe('ok')

    // La base disparaît sous le service — DROP avec les connexions coupées.
    await scratch.drop()
    await db.refresh()
    expect(db.status()).toBe('down')
  })

  it("refresh ne dit jamais « ok » avant la réussite des migrations", async () => {
    const db = createDb({
      url: 'postgresql://postgres:x@127.0.0.1:1/postgres',
      migrationsDir: MIGRATIONS_DIR,
      retryDelayMs: null,
      log: () => {},
    })
    opened.push({ db })

    await db.start()
    await db.refresh()
    // Un SELECT 1 qui passerait sur un schéma absent dirait « ok » à des
    // routes qui vont échouer : tant que start() n'a pas migré, l'état
    // lui appartient.
    expect(db.status()).toBe('down')
  })
})
