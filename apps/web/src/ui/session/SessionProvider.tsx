import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { AuthUser } from '@owlog/contracts'

import { usePorts } from '@/ui/PortsProvider'

/**
 * État de session, côté React.
 *
 * La session vit dans un cookie `HttpOnly` que le code ne peut pas lire :
 * ce contexte est le reflet de `/auth/me`, interrogé une fois au montage.
 * `loading` distingue « pas encore su » de « pas de session » — le même
 * soin que `useSetting` : confondre les deux ferait clignoter les surfaces
 * de compte à chaque ouverture.
 *
 * Deux gestes, symétriques :
 *
 * - `establish(user)` — après une vérification réussie (code ou lien) :
 *   adopte le prénom serveur s'il existe (« le serveur fait autorité après
 *   connexion »), ré-arme le moteur de sync ;
 * - `clear()` — déconnexion : révoque la session serveur, efface les
 *   curseurs (leur existence est le bit « a déjà synchronisé » — un
 *   appareil déconnecté doit redevenir silencieux, pas se plaindre en 401),
 *   tait le moteur.
 */
export interface Session {
  readonly user: AuthUser | null
  readonly loading: boolean
  establish(user: AuthUser): Promise<void>
  clear(): Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const { auth, settings, sync } = usePorts()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let voided = false
    void auth.me().then((result) => {
      if (voided) return
      setUser(result.ok ? result.value : null)
      setLoading(false)
    })
    return () => {
      voided = true
    }
  }, [auth])

  const establish = useCallback(
    async (established: AuthUser) => {
      if (established.firstName !== null) {
        await settings.write('firstName', established.firstName)
      }
      setUser(established)
      // Ré-arme le moteur : la sync initiale démarre ici, et l'écran de
      // premier pull n'a plus qu'à l'observer.
      void sync.start()
    },
    [settings, sync],
  )

  const clear = useCallback(async () => {
    await auth.logout()
    await settings.remove('syncCursor')
    await settings.remove('syncCacheCursor')
    sync.stop()
    setUser(null)
  }, [auth, settings, sync])

  const session = useMemo<Session>(
    () => ({ user, loading, establish, clear }),
    [user, loading, establish, clear],
  )

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error('useSession must be used inside a SessionProvider')
  }
  return session
}
