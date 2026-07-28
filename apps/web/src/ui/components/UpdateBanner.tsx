import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { registerServiceWorker, type UpdateHandle } from '@/pwa/registerServiceWorker'

/**
 * Bandeau « nouvelle version disponible ».
 *
 * C'est le seul retour visible qu'un déploiement a atteint l'appareil. Sans
 * lui, la stratégie `prompt` du service worker garderait l'ancienne version
 * indéfiniment, et le piège serait invisible : l'app marche, elle est
 * simplement périmée.
 *
 * Il se place au-dessus de la tab bar plutôt qu'en haut : sur mobile, le
 * pouce est en bas, et un bandeau en haut d'un écran de 812px demande de
 * changer de main.
 */
export function UpdateBanner() {
  const { t } = useTranslation()
  const [handle, setHandle] = useState<UpdateHandle | null>(null)

  useEffect(() => {
    registerServiceWorker(setHandle)
  }, [])

  if (!handle) return null

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-border-accent bg-surface px-5 py-3 shadow-glow">
      <p className="font-mono text-[11px] text-text">{t('update.available')}</p>
      <button
        type="button"
        onClick={() => handle.apply()}
        className="min-h-0 rounded-action bg-gradient-action px-3 py-2 font-display text-[11px] font-bold text-bg"
      >
        {t('update.reload')}
      </button>
    </div>
  )
}
