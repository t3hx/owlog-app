import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import type { SyncStatus } from '@/ports/Sync'
import { useSetting } from '@/ui/hooks/useSetting'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Premier pull — plein écran, après la connexion d'un appareil.
 *
 * **Jamais d'accueil vide sous « Bonsoir » pendant le pull initial** : un
 * tracker qui affiche zéro titre à l'utilisateur qui vient précisément de
 * connecter son historique est un écran qui ment — au moment de plus forte
 * anxiété du parcours.
 *
 * Un compteur qui monte, pas une barre : le total n'est connu qu'à la fin.
 * La pagination par 500 le donne gratuitement, page par page. Pas d'étape
 * « terminé » à valider : l'accueil peuplé EST la confirmation.
 *
 * L'échec laisse les pages déjà tirées acquises (le curseur a avancé) :
 * « réessayer » reprend où on en était.
 */
export function FirstPull() {
  const { t } = useTranslation()
  const { sync } = usePorts()
  const [, navigate] = useLocation()
  const [status, setStatus] = useState<SyncStatus>(() => sync.status())
  const { value: firstName, loading } = useSetting('firstName')

  useEffect(() => sync.subscribe(() => setStatus(sync.status())), [sync])

  const done = !status.syncing && status.lastError === null
  const failed = !status.syncing && status.lastError !== null

  useEffect(() => {
    if (!done || loading) return
    // L'accueil si l'onboarding est passé (le prénom serveur a pu arriver
    // avec la session) ; sinon l'onboarding local pose sa seule question.
    navigate(firstName === undefined ? '/welcome' : '/', { replace: true })
  }, [done, loading, firstName, navigate])

  return (
    <section className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <p className="font-mono text-[11px] tracking-wide text-accent">
        {t('firstPull.eyebrow')}
      </p>

      <div className="flex flex-col items-center gap-2">
        <span className="font-display text-[44px] font-bold leading-none text-gradient-action">
          {status.pulledEvents}
        </span>
        <span className="font-mono text-[10px] text-muted">{t('firstPull.counter')}</span>
      </div>

      {failed && (
        <div className="flex w-full flex-col gap-3">
          <p
            role="alert"
            className="rounded-action border border-border bg-surface px-3 py-2 text-left font-mono text-[10.5px] leading-relaxed text-muted"
          >
            ! {t('firstPull.error')}
          </p>
          <button
            type="button"
            onClick={() => void sync.syncNow()}
            className="h-11 rounded-action border border-border-active font-display text-[13px] font-semibold tracking-[.5px] text-text transition-colors hover:border-accent"
          >
            {t('firstPull.retry')}
          </button>
        </div>
      )}
    </section>
  )
}
