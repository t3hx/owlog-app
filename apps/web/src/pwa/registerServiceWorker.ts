import { registerSW } from 'virtual:pwa-register'

/**
 * Enregistrement du service worker et détection des mises à jour.
 *
 * **Le déclencheur est `visibilitychange`, pas un intervalle.** Une PWA iOS
 * installée est suspendue en arrière-plan : un `setInterval` ne s'exécute
 * pas pendant ce temps, et le bandeau « nouvelle version » n'apparaîtrait
 * jamais. Le retour au premier plan est le seul moment fiable sur cette
 * plateforme.
 *
 * L'intervalle horaire reste, en complément, pour une session laissée
 * ouverte au premier plan sur un ordinateur.
 *
 * Stratégie `prompt` et non `autoUpdate` : recharger la page sous les
 * doigts de quelqu'un qui est en train de saisir un titre lui ferait perdre
 * sa frappe. Le bandeau lui laisse choisir le moment.
 */
const HOURLY = 60 * 60 * 1000

export interface UpdateHandle {
  /** Applique la mise à jour et recharge. */
  apply(): void
}

export function registerServiceWorker(onUpdateAvailable: (handle: UpdateHandle) => void) {
  const updateSW = registerSW({
    immediate: true,

    onNeedRefresh() {
      onUpdateAvailable({ apply: () => void updateSW(true) })
    },

    onRegisteredSW(_url, registration) {
      if (!registration) return

      const check = () => void registration.update()

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })

      window.setInterval(check, HOURLY)
    },
  })
}
