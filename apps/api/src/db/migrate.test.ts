import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterEach, describe, expect, inject, it } from 'vitest'

import { createScratchDb, type ScratchDb } from '../../test/scratchDb.ts'
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts'

/**
 * Le runner de migrations, contre un vrai Postgres.
 *
 * Trois choses se testent ici et nulle part ailleurs : l'application sur
 * base vierge, l'idempotence, et la concurrence de deux répliques qui
 * démarrent ensemble — le cas Dokploy qui a motivé l'advisory lock.
 */
const adminUrl = inject('databaseAdminUrl')

const opened: ScratchDb[] = []

async function scratch(): Promise<ScratchDb> {
  if (!adminUrl) throw new Error('no admin url')
  const db = await createScratchDb(adminUrl)
  opened.push(db)
  return db
}

async function query<T extends Record<string, unknown>>(
  url: string,
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query(sql, values)
    return result.rows as T[]
  } finally {
    await client.end()
  }
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.drop()))
})

describe.skipIf(!adminUrl)('runMigrations — schéma réel', () => {
  it('applique toutes les migrations sur une base vierge et crée les cinq tables', async () => {
    const db = await scratch()

    const result = await runMigrations({ url: db.url, dir: MIGRATIONS_DIR })

    expect(result.applied.length).toBeGreaterThan(0)

    const tables = await query<{ table_name: string }>(
      db.url,
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'`,
    )
    const names = tables.map((t) => t.table_name).sort()
    expect(names).toEqual([
      'auth_tokens',
      'events',
      'media_cache',
      'schema_migrations',
      'sessions',
      'users',
    ])
  })

  it("ne réapplique rien au second passage — l'idempotence du boot", async () => {
    const db = await scratch()

    await runMigrations({ url: db.url, dir: MIGRATIONS_DIR })
    const second = await runMigrations({ url: db.url, dir: MIGRATIONS_DIR })

    expect(second.applied).toEqual([])
  })

  it('deux répliques concurrentes migrent une base vierge sans se marcher dessus', async () => {
    const db = await scratch()

    // Les deux démarrent en même temps : sans advisory lock ni re-lecture
    // des versions après le lock, la seconde rejouerait les migrations que
    // la première vient d'appliquer.
    const [a, b] = await Promise.all([
      runMigrations({ url: db.url, dir: MIGRATIONS_DIR }),
      runMigrations({ url: db.url, dir: MIGRATIONS_DIR }),
    ])

    const all = [...a.applied, ...b.applied]
    expect(new Set(all).size).toBe(all.length)

    const rows = await query<{ version: string; n: string }>(
      db.url,
      `SELECT version, count(*) AS n FROM schema_migrations GROUP BY version`,
    )
    for (const row of rows) expect(Number(row.n)).toBe(1)
  })

  it("une migration cassée annule sa transaction, pas celles d'avant", async () => {
    const db = await scratch()
    const dir = await mkdtemp(join(tmpdir(), 'owlog-migrations-'))

    try {
      await writeFile(join(dir, '0001_ok.sql'), 'CREATE TABLE alpha (id int);')
      await writeFile(
        join(dir, '0002_broken.sql'),
        'CREATE TABLE beta (id int); SELECT * FROM does_not_exist;',
      )

      await expect(runMigrations({ url: db.url, dir })).rejects.toThrow(/0002_broken/)

      const tables = await query<{ table_name: string }>(
        db.url,
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('alpha', 'beta')`,
      )
      // Une transaction par migration : alpha survit, beta est annulée.
      expect(tables.map((t) => t.table_name)).toEqual(['alpha'])

      const versions = await query<{ version: string }>(
        db.url,
        'SELECT version FROM schema_migrations',
      )
      expect(versions.map((v) => v.version)).toEqual(['0001_ok.sql'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!adminUrl)('schéma — invariants du store', () => {
  const USER = '01920000-0000-7000-8000-000000000001'
  const EVENT = '01920000-0000-7000-8000-00000000000e'

  async function seeded(): Promise<ScratchDb> {
    const db = await scratch()
    await runMigrations({ url: db.url, dir: MIGRATIONS_DIR })
    await query(db.url, `INSERT INTO users (id, email) VALUES ($1, 'a@b.c')`, [USER])
    await query(
      db.url,
      `INSERT INTO events
         (user_id, id, device_id, type, media_ref, cycle_key,
          created_at, occurred_at, occurred_precision, payload)
       VALUES ($1, $2, 'local', 'WATCH', 'tmdb:tv/95396', NULL,
               now(), now(), 'exact', NULL)`,
      [USER, EVENT],
    )
    return db
  }

  it('events est append-only en base aussi : UPDATE et DELETE sont refusés', async () => {
    const db = await seeded()

    await expect(
      query(db.url, `UPDATE events SET type = 'SEEN' WHERE id = $1`, [EVENT]),
    ).rejects.toThrow(/append-only/)

    await expect(
      query(db.url, `DELETE FROM events WHERE id = $1`, [EVENT]),
    ).rejects.toThrow(/append-only/)
  })

  it("pousser deux fois le même événement ne double rien — l'idempotence du push", async () => {
    const db = await seeded()

    // Le geste exact que fera la réplication (F4) : même (user_id, id),
    // conflit ignoré.
    await query(
      db.url,
      `INSERT INTO events
         (user_id, id, device_id, type, media_ref, cycle_key,
          created_at, occurred_at, occurred_precision, payload)
       VALUES ($1, $2, 'local', 'WATCH', 'tmdb:tv/95396', NULL,
               now(), now(), 'exact', NULL)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [USER, EVENT],
    )

    const rows = await query<{ n: string }>(
      db.url,
      'SELECT count(*) AS n FROM events',
    )
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it("l'upsert du cache média avance son curseur updated_seq", async () => {
    const db = await seeded()

    // Le geste exact du push de cache (F4) : dernière version gagne, et la
    // ligne réécrite redevient visible du pull incrémental.
    const upsert = `
      INSERT INTO media_cache (user_id, ref, payload)
      VALUES ($1, 'tmdb:tv/95396', $2)
      ON CONFLICT (user_id, ref) DO UPDATE
        SET payload = EXCLUDED.payload,
            updated_seq = nextval('media_cache_seq')`

    await query(db.url, upsert, [USER, JSON.stringify({ title: 'Severance' })])
    const first = await query<{ updated_seq: string }>(
      db.url,
      'SELECT updated_seq FROM media_cache',
    )

    await query(db.url, upsert, [USER, JSON.stringify({ title: 'Severance', year: 2022 })])
    const second = await query<{ updated_seq: string; payload: { year?: number } }>(
      db.url,
      'SELECT updated_seq, payload FROM media_cache',
    )

    expect(second).toHaveLength(1)
    expect(second[0]?.payload.year).toBe(2022)
    expect(Number(second[0]?.updated_seq)).toBeGreaterThan(Number(first[0]?.updated_seq))
  })

  it('le server_seq est attribué par la base, croissant avec les insertions', async () => {
    const db = await seeded()

    await query(
      db.url,
      `INSERT INTO events
         (user_id, id, device_id, type, media_ref, cycle_key,
          created_at, occurred_at, occurred_precision, payload)
       VALUES ($1, '01920000-0000-7000-8000-00000000000f', 'local', 'START',
               'tmdb:tv/95396', 'ck-1', now(), now(), 'exact', NULL)`,
      [USER],
    )

    const rows = await query<{ server_seq: string }>(
      db.url,
      'SELECT server_seq FROM events ORDER BY server_seq',
    )
    expect(rows).toHaveLength(2)
    expect(Number(rows[1]?.server_seq)).toBeGreaterThan(Number(rows[0]?.server_seq))
  })
})
