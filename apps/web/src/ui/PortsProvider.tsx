import { createContext, useContext, type ReactNode } from 'react'

import type { EventStore } from '@/ports/EventStore'
import type { LiveQueries } from '@/ports/LiveQueries'
import type { MediaCatalog } from '@/ports/MediaCatalog'
import type { PendingAdds } from '@/ports/PendingAdds'
import type { SettingsStore } from '@/ports/SettingsStore'

/**
 * Injection des ports dans l'arbre React.
 *
 * L'UI ne connaît que des interfaces. Sans ce contexte, chaque écran
 * importerait l'adaptateur Dexie concret, et l'architecture hexagonale ne
 * serait plus qu'un dossier bien nommé : le jour du passage à Postgres, il
 * faudrait rouvrir chaque composant au lieu de changer une ligne au point
 * d'assemblage.
 *
 * Cette règle est appliquée mécaniquement par ESLint, pas seulement écrite :
 * un import de `adapters/` depuis `ui/` échoue au lint.
 *
 * Effet de bord utile : un test de composant fournit ses propres doubles en
 * enveloppant l'arbre, sans toucher à IndexedDB.
 */
export interface Ports {
  readonly settings: SettingsStore
  readonly events: EventStore
  readonly catalog: MediaCatalog
  readonly pending: PendingAdds
  readonly live: LiveQueries
}

const ContextePorts = createContext<Ports | null>(null)

export function PortsProvider({
  ports,
  children,
}: {
  ports: Ports
  children: ReactNode
}) {
  return <ContextePorts.Provider value={ports}>{children}</ContextePorts.Provider>
}

/**
 * Accède aux ports depuis un composant.
 *
 * Lève si le fournisseur est absent plutôt que de rendre `null` : un port
 * manquant est une erreur d'assemblage, et la faire échouer bruyamment au
 * développement coûte moins qu'un écran qui ne réagit pas en production.
 */
export function usePorts(): Ports {
  const ports = useContext(ContextePorts)
  if (!ports) {
    throw new Error('usePorts must be used inside a PortsProvider')
  }
  return ports
}
