import { useTranslation } from 'react-i18next'

import type { MediaStatus, Status } from '@owlog/domain'
import { STATUS_CHIP, STATUS_GLYPH, STATUSES } from '@/ui/components/status/statusStyle'

export interface StatusMenuProps {
  title: string
  current: MediaStatus
  onPick: (status: Status) => void
  onClose: () => void
}

/**
 * Menu de choix direct, ouvert par un appui long sur la pastille.
 *
 * Il existe pour une raison chiffrable : sans lui, passer un titre de
 * « à voir » à « abandonné » demande trois taps sur la pastille — et chacun
 * des deux premiers écrit un événement définitif dans un journal
 * append-only. On ne se retrouverait pas seulement avec un statut juste,
 * mais avec un cycle ouvert puis clos que personne n'a vécu.
 *
 * Feuille par le bas, comme la saisie d'un souvenir : le geste vient du
 * pouce, et une popup ancrée à la pastille tomberait sous le doigt qui vient
 * de la presser.
 */
export function StatusMenu({ title, current, onPick, onClose }: StatusMenuProps) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        onClick={onClose}
        aria-label={t('library.menuClose')}
        className="min-h-0 min-w-0 flex-1 bg-scrim"
      />

      <section className="rounded-t-sheet border-t border-border-accent bg-surface px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-4 shadow-sheet">
        <p className="truncate font-display text-base font-semibold text-text">{title}</p>
        <p className="mb-3.5 mt-0.5 font-mono text-[9.5px] text-subtle">
          {t('library.menuHint')}
        </p>

        <div className="flex flex-col gap-2">
          {STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onPick(option)}
              aria-pressed={current === option}
              disabled={current === option}
              className={[
                'flex h-11 items-center gap-2.5 rounded-action border px-3.5 font-mono text-[11px]',
                current === option
                  ? `${STATUS_CHIP[option].on} opacity-60`
                  : STATUS_CHIP[option].off,
              ].join(' ')}
            >
              <span>{STATUS_GLYPH[option]}</span>
              <span>{t(`status.${option}` as 'status.to-watch')}</span>
              {/* Le statut courant reste affiché mais inerte : le retirer
                  ferait bouger les quatre lignes d'un titre à l'autre, et
                  c'est la position qui rend le geste rapide. */}
              {current === option && (
                <span className="ml-auto text-[9.5px] text-subtle">
                  {t('library.menuCurrent')}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
