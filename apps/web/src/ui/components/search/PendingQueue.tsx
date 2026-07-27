import { useTranslation } from 'react-i18next'

import type { PendingAdd } from '@/ports/PendingAdds'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Bandeau des titres mis de côté hors-ligne.
 *
 * Il n'apparaît que s'il y a quelque chose à confirmer, et il propose une
 * seule action : reprendre la saisie dans la recherche. Un tap remplit la
 * barre avec le texte mis de côté, et le parcours redevient l'ajout normal.
 *
 * C'est ce qui rend la file supportable : rien de nouveau à apprendre au
 * retour du réseau, on retombe sur l'écran qu'on connaît déjà.
 */
export function PendingQueue({ onResume }: { onResume: (entry: PendingAdd) => void }) {
  const { t } = useTranslation()
  const { live, pending: queue } = usePorts()
  const pending = live.usePendingAdds()

  if (pending.length === 0) return null

  return (
    <section className="mx-3 mb-3 rounded-card border border-border-accent bg-surface-translucent p-3">
      <p className="mb-2 font-mono text-[10px] text-accent">
        {t('search.pendingBadge', { count: pending.length })}
      </p>

      <ul className="flex flex-col gap-1.5">
        {pending.map((entry) => (
          <li key={entry.id} className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onResume(entry)}
              className="min-h-0 flex-1 truncate text-left text-sm text-text underline decoration-border-active underline-offset-4"
            >
              {entry.text}
            </button>
            <button
              type="button"
              onClick={() => void queue.remove(entry.id)}
              className="min-h-0 min-w-0 flex-none font-mono text-[10px] text-subtle"
            >
              {t('search.dismissPending')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
