import type { ReactNode } from 'react'

/**
 * Une tuile de l'écran 9 : un chiffre, un label mono.
 *
 * Valeurs du mock 9d : card `rgba(18,23,36,.75)`, bordure `#212a3d`, rayon
 * 14px, chiffre Chakra Petch 19px, label mono 9px.
 *
 * **Zéro s'affiche.** Un compte tout neuf montre `0 vus`, pas une tuile
 * absente : les zéros sont des données, et masquer la tuile ferait croire
 * que la mesure n'existe pas. Seul `—` remplace la valeur quand elle n'a
 * pas de sens — une compat sans recouvrement, jamais un `0 %` qui
 * affirmerait « nous n'avons rien en commun ».
 */
export function ProfileTile({
  value,
  label,
  tone,
}: {
  readonly value: ReactNode
  readonly label: string
  /** Bleu pour les vus, dégradé pour les coups de cœur, menthe pour la compat. */
  readonly tone: 'seen' | 'favorite' | 'compat'
}) {
  const valueClass =
    tone === 'favorite'
      ? 'text-gradient-action font-display text-[19px] font-bold'
      : tone === 'compat'
        ? 'font-display text-[19px] font-bold text-accent'
        : 'font-display text-[19px] font-bold text-status-seen'

  return (
    <div className="flex flex-1 flex-col items-center gap-[3px] rounded-card border border-border bg-surface-translucent p-3">
      <span className={valueClass}>{value}</span>
      <span className="font-mono text-[9px] text-muted">{label}</span>
    </div>
  )
}
