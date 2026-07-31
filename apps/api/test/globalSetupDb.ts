import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

import type { TestProject } from 'vitest/node'

const execFile = promisify(execFileCb)

/**
 * Démarre un Postgres jetable pour les tests d'intégration.
 *
 * Un vrai Postgres, pas une émulation : le runner de migrations repose sur
 * `pg_advisory_lock`, et un verrou ne se teste qu'avec plusieurs connexions
 * réelles en concurrence — précisément ce qu'un Postgres in-process
 * mono-connexion ne sait pas faire.
 *
 * Le conteneur écoute sur un port éphémère de l'hôte (`-p 127.0.0.1:0`) :
 * deux lancements de la suite ne se marchent pas dessus, et rien n'est
 * exposé hors de la machine.
 *
 * Sans Docker, les tests DB sont ignorés — avec un avertissement bruyant
 * plutôt qu'un échec : la suite doit rester exécutable sur une machine de
 * passage, mais un saut silencieux ferait croire à une couverture qui
 * n'existe pas.
 */
const IMAGE = 'postgres:17-alpine'
const PASSWORD = 'owlog-test'
const READY_TIMEOUT_MS = 30_000

export default async function setup(project: TestProject) {
  const name = `owlog-test-pg-${process.pid}`

  try {
    await execFile('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '-e',
      `POSTGRES_PASSWORD=${PASSWORD}`,
      '-p',
      '127.0.0.1:0:5432',
      IMAGE,
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[db] Postgres de test non démarré — tests d'intégration DB ignorés.\n${message}`,
    )
    project.provide('databaseAdminUrl', null)
    return
  }

  const { stdout } = await execFile('docker', ['port', name, '5432/tcp'])
  const port = stdout.trim().split('\n')[0]?.split(':').pop()
  if (!port) throw new Error(`docker port returned nothing for ${name}`)

  /*
   * `pg_isready` doit viser 127.0.0.1 : pendant l'initialisation, l'image
   * postgres lance un serveur temporaire qui n'écoute que sur la socket
   * Unix — la sonde par défaut le prendrait pour le vrai.
   */
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    try {
      await execFile('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'])
      break
    } catch {
      if (Date.now() > deadline) {
        await execFile('docker', ['rm', '-f', name]).catch(() => {})
        throw new Error(`Postgres test container not ready after ${READY_TIMEOUT_MS}ms`)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  project.provide(
    'databaseAdminUrl',
    `postgresql://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`,
  )

  return async () => {
    await execFile('docker', ['rm', '-f', name]).catch(() => {})
  }
}
