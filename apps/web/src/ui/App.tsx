import { Route, Switch } from 'wouter'

import { EcranEnConstruction } from '@/ui/components/EcranEnConstruction'
import { TabBar } from '@/ui/components/TabBar'

/**
 * Racine de l'application.
 *
 * Routing en mode history, pas en hash. Ce choix impose deux choses en aval,
 * toutes deux traitées à l'étape 3 : un rewrite SPA dans le Caddyfile pour
 * que `/bibliotheque` serve `index.html`, et `navigateFallback` dans la
 * configuration Workbox pour que la même règle vaille hors-ligne.
 *
 * Le padding bas laisse la place à la tab bar fixe, encoche iPhone comprise.
 */
export function App() {
  return (
    <div className="min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <Switch>
        <Route path="/">
          <EcranEnConstruction
            titre="Accueil"
            etape={8}
            quoi="Ce que tu regardes en ce moment, et ce que tu as mis de côté."
          />
        </Route>
        <Route path="/bibliotheque">
          <EcranEnConstruction
            titre="Bibliothèque"
            etape={10}
            quoi="Tout ce que tu as logué, filtrable par statut et par coup de cœur."
          />
        </Route>
        <Route path="/log">
          <EcranEnConstruction
            titre="Log"
            etape={9}
            quoi="Le flux horodaté de tout ce que tu as fait. Le tail -f de ta vie de spectateur."
          />
        </Route>
        <Route path="/stats">
          <EcranEnConstruction
            titre="Stats"
            etape={11}
            quoi="Temps total, répartition, notes, genres. Tout calculé depuis tes visionnages."
          />
        </Route>
        <Route>
          <EcranEnConstruction
            titre="Page introuvable"
            etape={1}
            quoi="Cette adresse ne correspond à aucun écran."
          />
        </Route>
      </Switch>

      <TabBar />
    </div>
  )
}
