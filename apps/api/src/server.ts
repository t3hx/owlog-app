import { serve } from '@hono/node-server'

import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createDb } from './db/db.ts'
import { MIGRATIONS_DIR } from './db/migrate.ts'
import { createConsoleMailer, createHttpMailer } from './mail/mailer.ts'

/**
 * Point d'entrée du service.
 *
 * Il échoue bruyamment si un secret manque, plutôt que de démarrer et de
 * renvoyer des 500 sur chaque recherche : une panne au démarrage se
 * diagnostique en une ligne de log, une panne silencieuse se diagnostique
 * en une soirée.
 *
 * Exception voulue : la base. Une base injoignable au boot n'empêche pas
 * le démarrage — le proxy TMDB doit vivre sans elle, et `db.start()`
 * réessaie tout seul. Voir `db/db.ts`.
 */
const config = loadConfig()

const db = config.databaseUrl
  ? createDb({ url: config.databaseUrl, migrationsDir: MIGRATIONS_DIR })
  : undefined

if (db) void db.start()

// Sans fournisseur configuré, les e-mails partent dans la console — assez
// pour dérouler le parcours de connexion en local, bruyant pour qu'on ne
// croie jamais à un envoi réel.
const mailer = config.email ? createHttpMailer(config.email) : createConsoleMailer()

const app = createApp({ config, mailer, ...(db ? { db } : {}) })

serve({ fetch: app.fetch, port: config.port }, (info) => {
  // Le chemin de montage figure dans le log de demarrage, et pas seulement
  // le port. C'est la seule ligne que Dokploy montre sans effort, et sans
  // elle un service monte au mauvais endroit repond 404 sans jamais dire
  // sous quel prefixe il ecoute.
  const mount = config.basePath === '' ? 'root' : config.basePath
  const dbState = config.databaseUrl ? 'configured' : 'off'
  console.log(`owlog-api listening on :${info.port}, routes mounted at ${mount}, db ${dbState}`)
})
