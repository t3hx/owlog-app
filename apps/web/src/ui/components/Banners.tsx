import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'

import type { SyncStatus } from '@/ports/Sync'
import { registerServiceWorker, type UpdateHandle } from '@/pwa/registerServiceWorker'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Les bandeaux au-dessus de la tab bar — UN SEUL à la fois.
 *
 * Deux candidats : « nouvelle version disponible » et « session expirée ».
 * La mise à jour est prioritaire : une app périmée est un problème pour
 * tout le monde, une session expirée seulement pour la sync — et deux
 * bandeaux empilés cacheraient la tab bar.
 *
 * Position basse : sur mobile, le pouce est en bas, et un bandeau en haut
 * d'un écran de 812px demande de changer de main.
 */
export function Banners() {
  const { t } = useTranslation()
  const { sync } = usePorts()
  const [handle, setHandle] = useState<UpdateHandle | null>(null)
  const [status, setStatus] = useState<SyncStatus>(() => sync.status())

  useEffect(() => {
    registerServiceWorker(setHandle)
  }, [])

  useEffect(() => sync.subscribe(() => setStatus(sync.status())), [sync])

  if (handle) {
    return (
      <Banner>
        <p className="font-mono text-[11px] text-text">{t('update.available')}</p>
        <button
          type="button"
          onClick={() => handle.apply()}
          className="min-h-0 rounded-action bg-gradient-action px-3 py-2 font-display text-[11px] font-bold text-bg"
        >
          {t('update.reload')}
        </button>
      </Banner>
    )
  }

  if (status.unauthorized) {
    return (
      <Banner>
        <p className="font-mono text-[11px] text-text">{t('session.expired')}</p>
        <Link
          href="/login"
          className="min-h-0 rounded-action bg-gradient-action px-3 py-2 font-display text-[11px] font-bold text-bg"
        >
          {t('session.reconnect')}
        </Link>
      </Banner>
    )
  }

  return null
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-border-accent bg-surface px-5 py-3 shadow-glow">
      {children}
    </div>
  )
}
