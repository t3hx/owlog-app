import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { eventStore } from '@/adapters/dexie/eventStore'
import { settingsStore } from '@/adapters/dexie/settingsStore'
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

createRoot(container).render(
  <StrictMode>
    <PortsProvider ports={{ settings: settingsStore, events: eventStore }}>
      <App />
    </PortsProvider>
  </StrictMode>,
)
