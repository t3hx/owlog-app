import type { SyncFailure } from '@/ports/SyncGateway'

/**
 * Port du moteur de synchronisation, tel que l'UI le voit.
 *
 * L'UI n'orchestre rien : elle affiche l'état, déclenche une passe
 * (retour au premier plan), et offre « re-pousser tout ». Tout le reste —
 * debounce, pagination, scission des 413, règles du 401 — vit dans
 * l'adaptateur, hors de portée des composants.
 */
export interface SyncStatus {
  /** Une passe de sync est en cours. */
  readonly syncing: boolean
  /** Fin de la dernière passe entièrement réussie, ISO. */
  readonly lastSyncAt: string | null
  /** Dernier échec parlant. `not-deployed` et l'anonymat n'y entrent jamais. */
  readonly lastError: SyncFailure['kind'] | null
  /** Session expirée : l'UI doit inviter à se reconnecter — une fois. */
  readonly unauthorized: boolean
  /** Faux quand le moteur s'est tu (pas de compte, session expirée, stop). */
  readonly enabled: boolean
}

export interface SyncEngine {
  /** Branche l'observation de l'outbox et lance la sync initiale. */
  start(): Promise<void>
  stop(): void
  /** Une passe complète — les déclencheurs (réseau, premier plan) appellent ça. */
  syncNow(): Promise<void>
  /** « Re-pousser tout » : tout le journal et tout le cache. Idempotent. */
  repushAll(): Promise<void>
  status(): SyncStatus
  subscribe(callback: () => void): () => void
}
