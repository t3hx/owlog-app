import { UnderConstruction } from '@/ui/components/UnderConstruction'

/**
 * Accueil.
 *
 * L'écran complet — sections `▸ EN COURS` et `▸ À VOIR`, barre de
 * progression, bouton play — arrive à l'étape 8, une fois que le domaine
 * sait produire des événements et que la recherche sait ajouter des titres.
 *
 * Ce qui existe déjà : la salutation, qui prouve que le prénom demandé à la
 * première ouverture a bien été persisté et relu.
 */
export function Home({ firstName }: { firstName: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-1 px-5 pt-8">
      <h1 className="font-display text-[25px] font-semibold text-text">
        Bonsoir, {firstName}
      </h1>
      <p className="font-mono text-[11px] text-muted">› 0 en cours · 0 à voir</p>

      <UnderConstruction
        title="En cours"
        step={8}
        what="Les titres que tu regardes, avec leur progression et le bouton pour avancer."
      />
    </div>
  )
}
