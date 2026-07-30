import { Pool } from 'pg'

import { runMigrations } from './migrate.ts'

/**
 * La base du service, avec son état observable.
 *
 * Postgres est **optionnel au démarrage et faillible en marche** : le
 * proxy TMDB du temps 1 doit vivre sans lui. D'où deux propriétés :
 *
 * - `start()` ne lève jamais. Un échec de migration (base pas encore
 *   démarrée, réseau) laisse le statut à `down` et réessaie plus tard —
 *   si le boot échouait, Dokploy redémarrerait le service en boucle et le
 *   proxy TMDB mourrait avec la base.
 * - `status()` est **synchrone et sans requête** : c'est l'état connu,
 *   pas une sonde. La sonde de vie l'affiche sans jamais bloquer sur la
 *   base ; `refresh()` le remet à jour en arrière-plan.
 */
export type DbStatus = 'starting' | 'ok' | 'down'

export interface Db {
  /** État connu, sans requête. `ok` seulement une fois les migrations passées. */
  status(): DbStatus
  /** Sonde `SELECT 1` : met l'état à jour. Ne lève jamais. */
  refresh(): Promise<void>
  /** Migre, puis surveille. Ne lève jamais ; réessaie en cas d'échec. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Le pool, pour les routes à venir (auth, sync). */
  readonly pool: Pool
}

export interface DbOptions {
  readonly url: string
  readonly migrationsDir: string
  /**
   * Délai avant nouvelle tentative de migration, `null` pour ne pas
   * réessayer (tests). En production, une base qui démarre plus lentement
   * que l'API est un cas nominal de déploiement, pas une panne.
   */
  readonly retryDelayMs?: number | null
  readonly log?: (message: string) => void
}

const DEFAULT_RETRY_MS = 10_000

export function createDb(options: DbOptions): Db {
  const { url, migrationsDir, log = console.error } = options
  const retryDelayMs = options.retryDelayMs === undefined ? DEFAULT_RETRY_MS : options.retryDelayMs

  const pool = new Pool({ connectionString: url })
  // Un client du pool qui tombe (base redémarrée) émet `error` : sans ce
  // gestionnaire, l'événement non écouté ferait planter le process.
  pool.on('error', () => setStatus('down'))

  let status: DbStatus = 'starting'
  let migrated = false
  let stopped = false
  let retryTimer: NodeJS.Timeout | undefined

  function setStatus(next: DbStatus) {
    status = next
  }

  async function start(): Promise<void> {
    try {
      await runMigrations({ url, dir: migrationsDir })
      migrated = true
      setStatus('ok')
    } catch (error) {
      setStatus('down')
      const message = error instanceof Error ? error.message : String(error)
      log(`db: migrations failed, status=down: ${message}`)
      if (retryDelayMs !== null && !stopped) {
        retryTimer = setTimeout(() => void start(), retryDelayMs)
        // Un timer en attente n'empêche pas le process de s'arrêter.
        retryTimer.unref()
      }
    }
  }

  async function refresh(): Promise<void> {
    // Tant que les migrations n'ont pas réussi, l'état appartient à
    // `start()` : un SELECT 1 qui passe sur un schéma absent dirait « ok »
    // à des routes qui vont échouer.
    if (!migrated) return
    try {
      await pool.query('SELECT 1')
      setStatus('ok')
    } catch {
      setStatus('down')
    }
  }

  return {
    status: () => status,
    refresh,
    start,
    async stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      await pool.end()
    },
    pool,
  }
}
