import { useTranslation } from 'react-i18next'

import type { StoredEvent } from '@owlog/domain'

/**
 * Une entrée d'événement, telle qu'elle se lit : `2026-07-28 · vu`.
 *
 * Partagée par le journal de la fiche et par le LOG global. Deux écrans qui
 * affichent le même événement ne peuvent pas le nommer ni le colorer
 * différemment — c'est exactement le genre d'écart qui fait douter de ce que
 * l'app a enregistré.
 *
 * Rendue en `span` : les deux appelants l'enveloppent dans un bouton, l'un
 * pour l'appui long qui annule, l'autre pour ouvrir la fiche.
 */
export function EventText({ event }: { event: StoredEvent }) {
  const { t } = useTranslation()

  return (
    <>
      <span className="text-subtle">{shortDate(event.occurred_at)}</span>
      {' · '}
      <span className={eventColor(event.type)}>
        {t(`journal.${event.type}` as 'journal.WATCH', { defaultValue: event.type })}
      </span>
    </>
  )
}

/**
 * Couleur du verbe, par type.
 *
 * Les quatre couleurs de statut du handoff, appliquées au geste qui y mène.
 * Un type inconnu — écrit par une version ultérieure du client — sort en
 * `muted` plutôt que de ne pas s'afficher.
 */
export function eventColor(type: string): string {
  switch (type) {
    case 'WATCH':
      return 'text-status-watch'
    case 'START':
    case 'REWATCH':
      return 'text-status-current'
    case 'SEEN':
      return 'text-status-seen'
    case 'DROP':
    case 'REMOVE':
      return 'text-status-dropped'
    default:
      return 'text-muted'
  }
}

/**
 * Date courte, ou des points quand la précision est inconnue.
 *
 * On ne fabrique pas une date : écrire `2019-01-01` sur un souvenir daté « je
 * ne sais plus » ferait croire à un horodatage que personne n'a donné.
 */
export function shortDate(at: string | null): string {
  return at === null ? '····-··-··' : at.slice(0, 10)
}
