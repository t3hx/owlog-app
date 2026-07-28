import { posterUrl, type SearchHit } from '@owlog/contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BackdateEntry } from '@/domain/commands'
import type { DatePrecision } from '@/domain/types'
import type { BackdateOutcome } from '@/ui/hooks/useBackdate'

/**
 * Feuille de saisie d'un souvenir.
 *
 * Une feuille par-dessus la recherche, jamais un écran : une route dédiée
 * perdrait la requête et la liste de résultats à chaque validation, et il
 * faudrait retaper à chacun des vingt titres d'une session.
 *
 * L'année est le défaut. En loguant une mémothèque, le cas dominant est
 * « vers 2019 », pas « le 14 juin à 21 h » — mettre une précision à choisir
 * avant la date ferait deux décisions par titre au lieu d'une.
 */

/** Années proposées d'emblée. Au-delà, `← plus tôt` recule d'autant. */
const YEARS_SHOWN = 5

/**
 * Midi UTC plutôt que minuit.
 *
 * Une date affichée dans un fuseau à l'ouest de Greenwich reculerait d'un
 * jour à minuit : « vu le 3 » deviendrait « vu le 2 ». Midi laisse douze
 * heures de marge de chaque côté, ce qui couvre tous les fuseaux réels.
 */
const NOON = 'T12:00:00.000Z'

type Chosen =
  | { readonly kind: 'none' }
  | { readonly kind: 'year'; readonly year: number }
  | { readonly kind: 'day'; readonly date: string }
  | { readonly kind: 'unknown' }

export interface BackdateSheetProps {
  hit: SearchHit
  outcome: BackdateOutcome | null
  saving: boolean
  logged: number
  onSave: (entry: BackdateEntry) => void
  onAgain: () => void
  onClose: () => void
  /** Année de référence, injectée : le domaine interdit `Date` et l'écran s'y tient. */
  currentYear: number
}

export function BackdateSheet({
  hit,
  outcome,
  saving,
  logged,
  onSave,
  onAgain,
  onClose,
  currentYear,
}: BackdateSheetProps) {
  const { t } = useTranslation()

  const [chosen, setChosen] = useState<Chosen>({ kind: 'none' })
  const [oldest, setOldest] = useState(currentYear)
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState<string | null>(null)

  // Enchaîner sur le même titre remet la saisie à zéro : garder la date
  // précédente ferait enregistrer deux fois le même visionnage sur un geste
  // distrait, et c'est le geste le plus probable pendant une session longue.
  useEffect(() => {
    if (outcome === null) {
      setChosen({ kind: 'none' })
      setRating(null)
      setComment(null)
    }
  }, [outcome])

  const poster = posterUrl(hit.posterPath, 'w185')
  const years = Array.from({ length: YEARS_SHOWN }, (_, index) => oldest - index)

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label={t('backdate.close')}
        onClick={onClose}
        className="min-h-0 min-w-0 flex-1 bg-scrim"
      />

      {/* La tab bar reste visible et navigable, donc le contenu doit degager
          sa hauteur : sans ca le bouton d'enregistrement passe dessous et
          l'indication de precision sort de l'ecran. */}
      <section className="max-h-[88vh] overflow-y-auto rounded-t-sheet border-t border-border-accent bg-surface px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] shadow-sheet">
        <span className="mx-auto mb-3.5 mt-2.5 block h-1 w-9 rounded-full bg-border-active" />

        <header className="mb-4 flex items-center gap-3">
          {poster ? (
            <img
              src={poster}
              alt=""
              crossOrigin="anonymous"
              className="h-15 w-10 flex-none rounded-md object-cover"
            />
          ) : (
            <span className="h-15 w-10 flex-none rounded-md bg-poster-placeholder" />
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-base font-semibold leading-tight text-text">
              {hit.title}
            </p>
            <p className="mt-0.5 font-mono text-[9.5px] text-subtle">
              {[hit.year, t(hit.kind === 'tv' ? 'search.kindSeries' : 'search.kindMovie')]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </header>

        {outcome ? (
          <Confirmation
            outcome={outcome}
            logged={logged}
            onAgain={onAgain}
            onNext={onClose}
          />
        ) : (
          <>
            <Label>{t('backdate.when')}</Label>

            <div className="mb-2.5 flex gap-1.5 overflow-x-auto">
              {years.map((year) => (
                <Chip
                  key={year}
                  active={chosen.kind === 'year' && chosen.year === year}
                  onClick={() => setChosen({ kind: 'year', year })}
                  className="rounded-tab px-3 py-2.5 text-xs"
                >
                  {year}
                </Chip>
              ))}
            </div>

            <div className="mb-4 flex flex-wrap gap-1.5">
              <Chip
                active={false}
                onClick={() => setOldest((from) => from - YEARS_SHOWN)}
                className="rounded-full px-2.5 py-2 text-[10px]"
              >
                {t('backdate.earlier')}
              </Chip>

              <label
                className={[
                  'flex cursor-pointer items-center rounded-full border px-2.5 py-2 font-mono text-[10px]',
                  chosen.kind === 'day'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-subtle',
                ].join(' ')}
              >
                {chosen.kind === 'day' ? chosen.date : t('backdate.exactDate')}
                <input
                  type="date"
                  value={chosen.kind === 'day' ? chosen.date : ''}
                  onChange={(event) =>
                    setChosen(
                      event.target.value
                        ? { kind: 'day', date: event.target.value }
                        : { kind: 'none' },
                    )
                  }
                  className="sr-only"
                />
              </label>

              <Chip
                active={chosen.kind === 'unknown'}
                onClick={() => setChosen({ kind: 'unknown' })}
                className="rounded-full px-2.5 py-2 text-[10px]"
              >
                {t('backdate.unknown')}
              </Chip>
            </div>

            <Label>{t('backdate.ratingLabel')}</Label>
            <Stars value={rating} onPick={setRating} />

            {comment === null ? (
              <button
                type="button"
                onClick={() => setComment('')}
                className="mb-4 w-full rounded-tab border border-dashed border-border px-3 py-2.5 text-left font-mono text-[10.5px] text-muted"
              >
                {t('backdate.addComment')}
              </button>
            ) : (
              <textarea
                autoFocus
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t('backdate.commentPlaceholder')}
                className="mb-4 w-full rounded-tab border border-border bg-bg px-3 py-2.5 text-[13px] text-text placeholder:text-subtle"
              />
            )}

            <button
              type="button"
              disabled={chosen.kind === 'none' || saving}
              onClick={() =>
                onSave({
                  ...toDate(chosen),
                  ...(rating === null ? {} : { rating }),
                  ...(comment === null || comment.trim() === ''
                    ? {}
                    : { comment: comment.trim() }),
                })
              }
              className="flex h-12 w-full items-center justify-center rounded-action bg-gradient-action shadow-glow-strong disabled:opacity-40 disabled:shadow-none"
            >
              <span className="font-display text-[13.5px] font-semibold tracking-wide text-bg">
                {saving ? t('backdate.saving') : t('backdate.save')}
              </span>
            </button>

            <p className="mt-2.5 text-center font-mono text-[9px] text-subtle">{hint(chosen, t)}</p>
          </>
        )}
      </section>
    </div>
  )
}

/**
 * Confirmation.
 *
 * Elle dit **laquelle des deux branches** de la règle de rattachement a
 * joué. Sans ça, l'utilisateur ne peut pas faire confiance à la règle sans
 * ouvrir le journal après chaque saisie — et c'est précisément ce que
 * « vingt titres en une soirée sans pénibilité » interdit.
 */
function Confirmation({
  outcome,
  logged,
  onAgain,
  onNext,
}: {
  outcome: BackdateOutcome
  logged: number
  onAgain: () => void
  onNext: () => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <div className="mb-3.5 rounded-action border border-border-accent bg-accent/5 px-3.5 py-3">
        <p className="font-mono text-[11px] text-accent">
          {t(`backdate.${outcome.kind}` as 'backdate.attached', { number: outcome.number })}
        </p>
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted">
          {t(`backdate.${outcome.kind}Why` as 'backdate.attachedWhy')}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAgain}
          className="flex h-12 flex-1 items-center justify-center rounded-action border border-border-active px-2 text-center font-mono text-[10.5px] text-text"
        >
          {t('backdate.again')}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex h-12 flex-1 items-center justify-center rounded-action border border-border-accent px-2 text-center font-mono text-[10.5px] text-accent"
        >
          {t('backdate.next')}
        </button>
      </div>

      <p className="mt-3 text-center font-mono text-[9.5px] text-subtle">
        {t('backdate.count', { count: logged })}
      </p>
    </>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 font-mono text-[9.5px] tracking-wide text-subtle">{children}</p>
}

function Chip({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean
  onClick: () => void
  className: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'min-h-0 min-w-0 flex-none whitespace-nowrap border font-mono',
        active ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** Mêmes règles que la page média : re-tap sur la même étoile efface. */
function Stars({
  value,
  onPick,
}: {
  value: number | null
  onPick: (value: number | null) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mb-3.5 flex items-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onPick(value === star ? null : star)}
          aria-label={t('media.star', { count: star })}
          className={[
            'min-h-11 min-w-0 px-0.5 text-[22px] leading-none',
            value !== null && star <= value ? 'text-accent' : 'text-border-active',
          ].join(' ')}
        >
          ★
        </button>
      ))}
    </div>
  )
}

/**
 * Traduit le choix de l'écran en date du domaine.
 *
 * Trois des cinq précisions seulement. `month` et `exact` restent dans le
 * type parce que le store est append-only et qu'un import les produira, mais
 * aucun geste du temps 1 ne les émet.
 */
function toDate(chosen: Chosen): { date: string | null; precision: DatePrecision } {
  switch (chosen.kind) {
    case 'year':
      return { date: `${chosen.year}-01-01${NOON}`, precision: 'year' }
    case 'day':
      return { date: `${chosen.date}${NOON}`, precision: 'day' }
    default:
      return { date: null, precision: 'unknown' }
  }
}

function hint(chosen: Chosen, t: ReturnType<typeof useTranslation>['t']): string {
  switch (chosen.kind) {
    case 'year':
      return t('backdate.hintYear', { year: chosen.year })
    case 'day':
      return t('backdate.hintDay', { date: chosen.date })
    case 'unknown':
      return t('backdate.hintUnknown')
    default:
      return t('backdate.hintNone')
  }
}
