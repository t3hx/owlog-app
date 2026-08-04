import { avatarInitial } from '@/ui/identity'

/**
 * L'avatar d'une identité sociale — une initiale dans un cercle.
 *
 * **Il n'y a pas d'image de profil dans ce produit**, et ce n'est pas un
 * manque : téléverser un avatar demanderait un stockage de fichiers, une
 * modération et une politique de suppression, pour une information que le
 * pseudo porte déjà. L'initiale sort du pseudo, jamais du prénom
 * (`social.md` §3) — un seul système d'avatar.
 *
 * Deux tailles, relevées des mocks 9c/9d d'« Owlog Explorations » :
 *
 * - `row` 40px — rangée sociale. `social.md` écrit 36px ; la maquette fait
 *   foi sur les pixels, le document sur les états et les règles.
 * - `profile` 76px — en-tête de l'écran 9, liseré dégradé et glow.
 *
 * Le liseré menthe de la variante `active` dit « activité récente », et
 * c'est la seule information que le cercle transporte.
 */
export function Avatar({
  pseudo,
  size = 'row',
  active = false,
}: {
  readonly pseudo: string
  readonly size?: 'row' | 'profile'
  readonly active?: boolean
}) {
  if (size === 'profile') {
    return (
      <span
        aria-hidden
        className="border-gradient-raised flex size-[76px] items-center justify-center rounded-full font-display text-[26px] font-semibold text-accent shadow-glow-strong"
      >
        {avatarInitial(pseudo)}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className={
        active
          ? 'flex size-10 flex-none items-center justify-center rounded-full border border-border-accent bg-surface-raised text-[13px] font-semibold text-accent'
          : 'flex size-10 flex-none items-center justify-center rounded-full border border-border-active bg-surface-raised text-[13px] font-semibold text-status-seen'
      }
    >
      {avatarInitial(pseudo)}
    </span>
  )
}

/**
 * Fenêtre au-delà de laquelle une activité n'est plus « récente ».
 *
 * Le handoff dit « bordure menthe si activité live » sans chiffrer. Quarante-
 * huit heures : assez large pour qu'un ami qui regarde une série deux soirs
 * par semaine reste allumé, assez court pour que le liseré veuille encore
 * dire quelque chose. Il vit ici et nulle part ailleurs — la rangée et
 * l'en-tête de profil posent la même question.
 *
 * La comparaison porte sur `occurred_at`, donc sur le moment du visionnage
 * et non sur celui de la saisie : un rétro-datage d'il y a trois ans n'allume
 * pas le cercle, ce qui est exactement le sens voulu.
 */
const RECENT_ACTIVITY_MS = 48 * 60 * 60 * 1000

export function isRecent(at: string | null | undefined, now: number): boolean {
  if (!at) return false
  const when = Date.parse(at)
  return Number.isFinite(when) && now - when < RECENT_ACTIVITY_MS
}
