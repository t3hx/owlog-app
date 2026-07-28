import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { eventStore } from '@/adapters/dexie/eventStore'
import { liveQueries } from '@/adapters/dexie/hooks'
import { pendingAdds } from '@/adapters/dexie/pendingAdds'
import { settingsStore } from '@/adapters/dexie/settingsStore'
import { createMediaCatalog } from '@/adapters/tmdb-http/mediaCatalog'
import '@/i18n'
import { App } from '@/ui/App'
import { PortsProvider } from '@/ui/PortsProvider'
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
const catalog = createMediaCatalog({
  baseUrl: orFallback(import.meta.env.VITE_API_URL, 'http://localhost:8787'),
  sharedToken: orFallback(import.meta.env.VITE_SHARED_TOKEN, 'local-token'),
})

function orFallback(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value
}

createRoot(container).render(
  <StrictMode>
    <PortsProvider ports={{
        settings: settingsStore,
        events: eventStore,
        catalog,
        pending: pendingAdds,
        live: liveQueries,
      }}>
      <App />
    </PortsProvider>
  </StrictMode>,
)
