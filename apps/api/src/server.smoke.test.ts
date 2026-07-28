import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * Démarrage sous la commande de production, et rien d'autre.
 *
 * Les autres tests montent l'application par `createApp` et passent sous
 * Vitest, qui **compile** le TypeScript. La production, elle, exécute
 * `node --experimental-strip-types` : Node retire les annotations de type
 * sans jamais compiler. Toute syntaxe qui produit du code plutôt que
 * d'annoter — propriété de paramètre, `enum`, `namespace` — casse alors le
 * démarrage, et uniquement là.
 *
 * C'est arrivé : une propriété de paramètre dans `UpstreamError` rendait le
 * service impossible à lancer en conteneur, alors que les dix-neuf tests de
 * route étaient verts. Le lint interdit désormais cette syntaxe ; ce test
 * couvre le reste de la classe, y compris ce que le lint ne sait pas voir —
 * une dépendance qui ne se résout pas, un `exports` mal orienté, un secret
 * dont l'absence n'est pas signalée.
 *
 * Il ne teste pas le comportement des routes : il vérifie que le processus
 * que Docker lancera répond.
 */

/** Hors de la plage des ports de développement, pour ne rien bousculer. */
const PORT = 8791

/**
 * Le préfixe de production, exercé ici et pas seulement en test unitaire.
 *
 * `createApp` reçoit un objet de configuration ; le conteneur, lui, reçoit
 * une variable d'environnement. C'est le trajet entre les deux — lecture,
 * normalisation, montage — que ce test couvre, et c'est précisément celui
 * dont une erreur ne se voit qu'en ligne.
 */
const BASE_PATH = '/api'

const entrypoint = fileURLToPath(new URL('./server.ts', import.meta.url))

let child: ReturnType<typeof spawn>

beforeAll(async () => {
  child = spawn(process.execPath, ['--experimental-strip-types', entrypoint], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TMDB_API_TOKEN: 'smoke-token',
      OWLOG_SHARED_TOKEN: 'smoke-shared',
      OWLOG_ALLOWED_ORIGINS: 'http://localhost',
      OWLOG_TRUSTED_PROXIES: '127.0.0.1',
      OWLOG_BASE_PATH: BASE_PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output: string[] = []
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))

  // On sonde plutôt que d'attendre un délai fixe : une attente arbitraire est
  // soit trop courte sur une machine chargée, soit du temps perdu à chaque
  // exécution. Si le processus meurt, on rend sa sortie — c'est elle qui
  // porte le diagnostic.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with ${child.exitCode}:\n${output.join('')}`)
    }
    try {
      await fetch(`http://127.0.0.1:${PORT}${BASE_PATH}/health`)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw new Error(`server never answered on :${PORT}:\n${output.join('')}`)
}, 15_000)

afterAll(() => {
  child?.kill()
})

it('démarre sous la commande de production et répond à la sonde de vie', async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}${BASE_PATH}/health`)

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok' })
})

it('lit le préfixe depuis son environnement, pas seulement depuis un objet', async () => {
  // La racine ne doit plus répondre : c'est ce qui prouve que la variable a
  // bien traversé la lecture de configuration jusqu'au montage des routes.
  const response = await fetch(`http://127.0.0.1:${PORT}/health`)

  expect(response.status).toBe(404)
})

it('applique le jeton partagé au processus réellement déployé', async () => {
  // Vérifié ici et pas seulement sur `createApp` : la configuration est lue
  // depuis l'environnement au démarrage, un chemin que les tests de route ne
  // traversent jamais.
  const response = await fetch(`http://127.0.0.1:${PORT}${BASE_PATH}/search?q=dune`)

  expect(response.status).toBe(401)
})
