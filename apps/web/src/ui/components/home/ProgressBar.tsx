/**
 * Barre de progression 4px.
 *
 * Dégradé **bleu vers menthe**, à l'inverse du dégradé des actions. Le
 * handoff veut l'inversion : elle distingue d'un coup d'œil ce qui avance de
 * ce sur quoi on tape.
 *
 * Faite de `span` et non de `div` : la barre est rendue **dans** le bouton
 * qui ouvre la fiche, et le contenu d'un `button` doit rester du contenu de
 * phrasé. Un `div` y serait invalide, et invalide veut dire rendu au jugé
 * par chaque navigateur.
 *
 * La largeur est une valeur calculée, donc un style en ligne. C'est le seul
 * endroit où il est justifié : une classe Tailwind ne peut pas porter un
 * pourcentage qui change à chaque tap.
 */
export function ProgressBar({ percent }: { percent: number }) {
  const width = Math.max(0, Math.min(100, percent))

  return (
    <span
      className="block h-1 w-full rounded-[2px] bg-border"
      role="progressbar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className="block h-full rounded-[2px] bg-gradient-progress shadow-glow-progress"
        style={{ width: `${width}%` }}
      />
    </span>
  )
}
