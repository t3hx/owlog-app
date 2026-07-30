import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createAuthGateway } from '@/adapters/auth-http/authGateway'
import { ensureDeviceId } from '@/adapters/browser/deviceId'
import { eventStore } from '@/adapters/dexie/eventStore'
import { liveQueries } from '@/adapters/dexie/hooks'
import { localData } from '@/adapters/dexie/localData'
import { outbox } from '@/adapters/dexie/outbox'
import { pendingAdds } from '@/adapters/dexie/pendingAdds'
import { settingsStore } from '@/adapters/dexie/settingsStore'
import { createSyncEngine } from '@/adapters/sync/engine'
import { createSyncGateway } from '@/adapters/sync-http/syncGateway'
import { createMediaCatalog } from '@/adapters/tmdb-http/mediaCatalog'
import '@/i18n'
import { App } from '@/ui/App'
import { PortsProvider } from '@/ui/PortsProvider'
import { SessionProvider } from '@/ui/session/SessionProvider'
import '@/ui/styles/tokens.css'

/**
 * Point d'assemblage.
 *
 * C'est le seul endroit de l'application autorisé à connaître des
 * implémentations concrètes : il branche les adaptateurs sur les ports et
 * les injecte dans l'arbre React. Partout ailleurs, un import de
 * `adapters/` échoue au lint.
 *
 * Concrètement : le jour du passage à Postgres, c'est ce fichier qui change,
 * et lui seul.
 */
const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root not found in index.html')
}
// Constante rétrécie une fois pour toutes : le rétrécissement de `container`
// ne traverse pas la fermeture asynchrone de `boot`.
const root: HTMLElement = container

/**
 * Adresse de l'API et jeton partagé.
 *
 * Injectés au build par Vite. Le jeton est public par nature — il vit dans
 * le bundle, donc dans les outils de développement de quiconque ouvre
 * l'app. Il ne protège pas le service, il filtre le bruit ; la vraie
 * protection du quota TMDB est la limitation de débit côté serveur.
 *
 * Les valeurs de repli servent au développement local, où Vite ne reçoit
 * aucune variable : `local-token` doit être la valeur passée en
 * `OWLOG_SHARED_TOKEN` au service, sans quoi chaque recherche répond 401.
 *
 * Une chaîne vide compte comme absente. `??` ne rattrape que `null` et
 * `undefined`, or un `ARG` Docker non fourni vaut la chaîne vide : le repli
 * ne se déclenchait pas, et le bundle sortait avec une base d'API vide qui
 * appelait `/search` au lieu de `/api/search`. Le Dockerfile refuse
 * désormais de construire sans ces arguments ; ceci reste la seconde
 * barrière, pour toute autre voie qui produirait la même valeur vide.
 */
const baseUrl = orFallback(import.meta.env.VITE_API_URL, 'http://localhost:8787')
const sharedToken = orFallback(import.meta.env.VITE_SHARED_TOKEN, 'local-token')

const catalog = createMediaCatalog({ baseUrl, sharedToken })

function orFallback(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value
}

/**
 * Le moteur de synchronisation et ses trois déclencheurs de pull :
 * démarrage, retour du réseau, retour au premier plan. Le push, lui, se
 * déclenche tout seul — le moteur observe l'outbox.
 *
 * Démarré sans condition : sans compte, la première passe reçoit un 401 et
 * le moteur se tait de lui-même — le compte est optionnel, et l'app reste
 * exactement le temps 1.
 */
const sync = createSyncEngine({
  gateway: createSyncGateway({ baseUrl, sharedToken }),
  store: eventStore,
  outbox,
  settings: settingsStore,
})

void sync.start()
window.addEventListener('online', () => void sync.syncNow())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void sync.syncNow()
})

/**
 * Stockage persistant : sans cette demande, IndexedDB est évincable sous
 * pression disque — c'est-à-dire le journal entier. Quasi garantie sur PWA
 * installée Android ; le compte étant optionnel, le filet serveur ne
 * couvre pas tout le monde, celui-ci si. Fire-and-forget : un refus ne
 * change rien à ce que l'app peut faire.
 */
void navigator.storage?.persist?.()

/**
 * L'identité de l'installation se résout AVANT le premier rendu : les
 * commandes en ont besoin de façon synchrone au moment d'un geste, et un
 * rendu qui partirait sans elle écrirait des événements anonymes. C'est une
 * lecture IndexedDB unique — invisible à l'œil, y compris au premier
 * démarrage où elle minte l'identifiant.
 *
 * Une fonction et non un `await` de premier niveau : la cible de build
 * (es2020, Safari 14) ne le connaît pas. C'est aussi l'embryon du gate de
 * boot — tout ce qui doit être su avant le premier rendu se résout ici.
 */
async function boot(): Promise<void> {
  const deviceId = await ensureDeviceId(settingsStore)

  createRoot(root).render(
    <StrictMode>
      <PortsProvider ports={{
          settings: settingsStore,
          events: eventStore,
          catalog,
          pending: pendingAdds,
          live: liveQueries,
          deviceId,
          sync,
          auth: createAuthGateway({ baseUrl, sharedToken }),
          local: localData,
        }}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </PortsProvider>
    </StrictMode>,
  )
}

void boot()
