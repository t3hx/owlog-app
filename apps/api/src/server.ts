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
  // Le chemin de montage figure dans le log de demarrage, et pas seulement
  // le port. C'est la seule ligne que Dokploy montre sans effort, et sans
  // elle un service monte au mauvais endroit repond 404 sans jamais dire
  // sous quel prefixe il ecoute.
  const mount = config.basePath === '' ? 'root' : config.basePath
  console.log(`owlog-api listening on :${info.port}, routes mounted at ${mount}`)
})
