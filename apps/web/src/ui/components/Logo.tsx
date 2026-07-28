/**
 * Wordmark OWLOG.
 *
 * Chakra Petch 700, letter-spacing 1px, le O du milieu en menthe avec son
 * glow. C'est un texte, pas une image : il reste net à toute densité et il
 * ne coûte aucune requête réseau, donc il s'affiche en mode avion.
 *
 * Le O accentué est celui de « log » — le nom du produit contient sa thèse.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={`font-display text-lg font-bold tracking-[1px] text-text ${className ?? ''}`}
    >
      OWL
      <span className="text-accent [text-shadow:0_0_12px_rgb(39_255_147/0.55)]">O</span>G
    </span>
  )
}
