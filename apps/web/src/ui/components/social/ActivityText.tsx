import { useTranslation } from 'react-i18next'

import type { FriendActivity } from '@owlog/contracts'

import { eventColor, shortDate } from '@/ui/components/journal/EventText'

/**
 * Une ligne d'activité d'un ami : `2026-07-28 · vu Severance`.
 *
 * **Le même vocabulaire que le LOG, délibérément.** Les maquettes 9c/9d
 * narrent au présent (`● regarde Severance S02`) là où le journal nomme le
 * geste (`commencé`). Suivre la maquette créerait un second vocabulaire pour
 * les mêmes événements — exactement ce que l'en-tête d'`EventText` interdit :
 * deux surfaces qui nomment différemment le même fait font douter de ce que
 * l'app a enregistré. Les libellés `journal.*` et les couleurs de statut sont
 * donc partagés ; seule la date est optionnelle.
 *
 * Ce que la maquette montre et que le serveur ne servira jamais : `a noté
 * Dune ★5`. `RATE` est hors de la whitelist de `publicProfile()` — « une note
 * est un jugement » — et cette exclusion est une décision de visibilité, pas
 * un oubli d'implémentation.
 */
export function ActivityText({
  activity,
  withDate = false,
}: {
  readonly activity: FriendActivity
  readonly withDate?: boolean
}) {
  const { t } = useTranslation()

  return (
    <>
      {withDate && (
        <>
          <span className="text-subtle">{shortDate(activity.at)}</span>
          {' · '}
        </>
      )}
      <span className={eventColor(activity.type)}>
        {t(`journal.${activity.type}` as 'journal.WATCH', { defaultValue: activity.type })}
      </span>
      {' '}
      {/* Jamais une référence nue : un titre absent du cache serveur se dit,
          il ne s'affiche pas en `tmdb:movie/603`. */}
      <span className="text-text">{activity.title ?? t('home.uncached')}</span>
    </>
  )
}
