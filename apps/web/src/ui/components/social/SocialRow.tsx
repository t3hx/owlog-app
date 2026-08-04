import type { ReactNode } from 'react'

import { Avatar } from '@/ui/components/social/Avatar'

/**
 * La rangée sociale — le composant que trois listes se partagent.
 *
 * Demandes, amis et résultats de recherche affichent la même chose : un
 * avatar, un pseudo, une seconde ligne mono, une zone d'action à droite.
 * Trois rangées distinctes auraient divergé au premier ajustement, et
 * l'écart se serait lu comme un défaut de soin.
 *
 * Valeurs du mock 9c : card `rgba(18,23,36,.75)`, bordure `#212a3d`, rayon
 * 14px, padding 10px, écart 12px. La variante `highlight` reprend la
 * bordure accent et le halo discret que le mock donne à l'ami actif.
 *
 * `action` est un `ReactNode` et non une liste de props : les trois usages
 * n'ont rien en commun de ce côté — deux boutons 44px pour une demande, un
 * chiffre mono pour un ami, un bouton d'ajout pour un résultat. Les
 * paramétrer aurait produit un composant qui connaît les trois écrans.
 */
export function SocialRow({
  pseudo,
  detail,
  active = false,
  action,
}: {
  readonly pseudo: string
  /**
   * Seconde ligne mono : activité, ou « membre depuis … ».
   *
   * Un `ReactNode` et non une chaîne : une ligne d'activité porte ses
   * propres couleurs de statut, et les recomposer ici dupliquerait
   * `ActivityText`.
   */
  readonly detail: ReactNode
  readonly active?: boolean
  readonly action?: ReactNode
}) {
  return (
    <div
      className={
        active
          ? 'flex items-center gap-3 rounded-card border border-border-accent bg-surface p-2.5'
          : 'flex items-center gap-3 rounded-card border border-border bg-surface-translucent p-2.5'
      }
    >
      <Avatar pseudo={pseudo} active={active} />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-semibold text-text">@{pseudo}</span>
        <span className="truncate font-mono text-[9.5px] text-muted">{detail}</span>
      </span>

      {action}
    </div>
  )
}
