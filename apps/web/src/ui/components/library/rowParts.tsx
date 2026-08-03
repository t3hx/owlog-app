import type { useTranslation } from 'react-i18next'

import type { MediaStateRow, Status } from '@owlog/domain'
import { STATUS_GLYPH } from '@/ui/components/status/statusStyle'

/**
 * Morceaux partages par la rangee mobile et le tableau desktop de la
 * bibliotheque.
 *
 * Ils vivent ici et non dans `LibraryRow` parce que les deux formats rendent
 * exactement la meme affiche, les memes etoiles et la meme pastille — seules
 * leurs tailles et leur disposition changent. Les dupliquer ferait diverger
 * la regle du coup de coeur au premier ajustement, et cette regle est l'une
 * des trois que le projet surveille explicitement.
 */

/**
 * Affiche d'une rangee.
 *
 * Coup de coeur : lisere degrade 1px + glow **sur l'affiche**, jamais sur la
 * card — la regle du handoff, identique a celle de la fiche media.
 *
 * `shape` porte la geometrie de l'appelant : 48x72 en mobile, 34x50 dans le
 * tableau desktop. Le rayon interieur de la variante coup de coeur suit d'un
 * cran en dessous, sinon le lisere deborde des angles.
 */
export function RowPoster({
  src,
  favorite,
  shape,
  innerRadius,
  width,
  height,
}: {
  src: string | null
  favorite: boolean
  shape: string
  innerRadius: string
  width: number
  height: number
}) {
  const image = src ? (
    <img
      src={src}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      crossOrigin="anonymous"
      className={favorite ? `size-full ${innerRadius} object-cover` : `${shape} object-cover`}
    />
  ) : null

  if (!favorite) {
    return image ?? <span className={`${shape} bg-poster-placeholder`} />
  }

  return (
    <span className={`${shape} border-gradient shadow-glow`}>
      {image ?? <span className={`block size-full ${innerRadius} bg-poster-placeholder`} />}
    </span>
  )
}

/**
 * Etoiles en lecture seule.
 *
 * Pleines en menthe, vides en `border-active` : c'est le rendu du handoff, et
 * le tapable reste sur la fiche. Une note qui se change depuis la liste serait
 * un geste a un tap d'erreur d'un statut.
 */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={`tracking-[1.5px] text-accent ${className ?? 'text-[11px]'}`}>
      {'★'.repeat(value)}
      <span className="text-border-active">{'★'.repeat(5 - value)}</span>
    </span>
  )
}

/** `✓ vu ×3` plutot que `✓ vu` : le compteur de visionnages est la these. */
export function statusLabel(
  row: MediaStateRow,
  status: Status,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (status === 'seen' && row.seenCount > 0) {
    return t('media.seenCount', { count: row.seenCount })
  }

  return `${STATUS_GLYPH[status]} ${t(`status.${status}` as 'status.to-watch')}`
}

/** `absent` n'est pas un statut affichable : c'est l'avant-premier evenement. */
export function displayStatus(row: MediaStateRow): Status {
  return row.status === 'absent' ? 'to-watch' : row.status
}
