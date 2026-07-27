import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { eventStore } from '@/adapters/dexie/eventStore'
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
 */
const catalog = createMediaCatalog({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:8787',
  sharedToken: import.meta.env.VITE_SHARED_TOKEN ?? 'jeton-local',
})

createRoot(container).render(
  <StrictMode>
    <PortsProvider ports={{ settings: settingsStore, events: eventStore, catalog }}>
      <App />
    </PortsProvider>
  </StrictMode>,
)
