import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'

/**
 * Runner de migrations.
 *
 * Appliqué au démarrage du service, sous advisory lock Postgres : deux
 * répliques qui redémarrent ensemble (déploiement Dokploy) ne migrent pas
 * en concurrence — la seconde attend le verrou, relit les versions, et ne
 * trouve plus rien à faire.
 *
 * Deux règles non négociables, chacune couverte par un test :
 *
 * - **La liste des versions appliquées se lit APRÈS l'acquisition du
 *   verrou.** La lire avant serait un time-of-check/time-of-use : les deux
 *   répliques verraient « base vierge » et la seconde rejouerait tout.
 * - **Une transaction par migration.** Un fichier qui casse annule ses
 *   propres effets et seulement eux : les migrations déjà commitées
 *   restent, et la reprise repart exactement du fichier fautif.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))

/**
 * Clé de l'advisory lock, arbitraire mais fixe : elle identifie « les
 * migrations d'Owlog » pour toute connexion à la même base.
 */
const MIGRATION_LOCK_KEY = 0x6f776c67 // « owlg »

export interface MigrateOptions {
  readonly url: string
  readonly dir: string
}

export interface MigrateResult {
  /** Noms de fichiers appliqués par CE passage, dans l'ordre. */
  readonly applied: readonly string[]
}

export async function runMigrations({ url, dir }: MigrateOptions): Promise<MigrateResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  const client = new Client({ connectionString: url })
  await client.connect()

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])

    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version     text PRIMARY KEY,
           applied_at  timestamptz NOT NULL DEFAULT now()
         )`,
      )

      // Re-lecture après le verrou — voir l'en-tête du fichier.
      const done = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations',
      )
      const alreadyApplied = new Set(done.rows.map((row) => row.version))

      const applied: string[] = []

      for (const file of files) {
        if (alreadyApplied.has(file)) continue

        const sql = await readFile(join(dir, file), 'utf8')

        await client.query('BEGIN')
        try {
          await client.query(sql)
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`migration ${file} failed: ${message}`, { cause: error })
        }

        applied.push(file)
      }

      return { applied }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    await client.end()
  }
}
