import { serve } from '@hono/node-server'

import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

/**
 * Point d'entrée du service.
 *
 * Il échoue bruyamment si un secret manque, plutôt que de démarrer et de
 * renvoyer des 500 sur chaque recherche : une panne au démarrage se
 * diagnostique en une ligne de log, une panne silencieuse se diagnostique
 * en une soirée.
 */
const config = loadConfig()

serve({ fetch: createApp({ config }).fetch, port: config.port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`owlog-api listening on :${info.port}`)
})
