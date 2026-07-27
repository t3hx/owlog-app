import { Logo } from '@/ui/components/Logo'

/**
 * Écran d'un onglet dont le contenu arrive à une étape ultérieure du plan.
 *
 * Il nomme explicitement l'étape plutôt que d'afficher un vide muet : entre
 * un écran blanc et un écran qui dit ce qui manque et quand, le second coûte
 * le même effort et n'induit personne en erreur.
 *
 * Ce composant disparaît quand la dernière étape est livrée. Il n'a pas
 * vocation à survivre au temps 1.
 */
export function EcranEnConstruction({
  titre,
  etape,
  quoi,
}: {
  titre: string
  etape: number
  quoi: string
}) {
  return (
    <section className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Logo className="opacity-30" />
      <h1 className="font-display text-[25px] font-semibold text-text">{titre}</h1>
      <p className="max-w-xs text-sm text-muted">{quoi}</p>
      <p className="font-mono text-[10px] text-subtle">étape {etape} du plan</p>
    </section>
  )
}
