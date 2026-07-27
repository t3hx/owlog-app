import { Route, Switch } from 'wouter'

import { EcranEnConstruction } from '@/ui/components/EcranEnConstruction'
import { TabBar } from '@/ui/components/TabBar'
import { useReglage } from '@/ui/hooks/useReglage'
import { Accueil } from '@/ui/screens/Accueil'
import { Bienvenue } from '@/ui/screens/Bienvenue'

/**
 * Racine de l'application.
 *
 * Routing en mode history, pas en hash. Ce choix impose deux choses en aval,
 * toutes deux traitées à l'étape 3 : un rewrite SPA dans le Caddyfile pour
 * que `/bibliotheque` serve `index.html`, et `navigateFallback` dans la
 * configuration Workbox pour que la même règle vaille hors-ligne.
 *
 * Tant que le prénom n'est pas renseigné, l'écran de bienvenue occupe toute
 * la vue, sans tab bar : à la première ouverture il n'y a rien à naviguer,
 * et quatre onglets vides donneraient l'impression d'une app cassée plutôt
 * que d'une app neuve.
 */
export function App() {
  const { valeur: prenom, chargement } = useReglage('prenom')

  // Premier rendu : on ne sait pas encore si le prénom existe. Afficher
  // l'écran de bienvenue tout de suite le ferait clignoter à chaque
  // ouverture, y compris pour quelqu'un qui l'a déjà renseigné.
  if (chargement) {
    return <div className="min-h-dvh" />
  }

  if (prenom === undefined) {
    return <Bienvenue />
  }

  return (
    <div className="min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <Switch>
        <Route path="/">
          <Accueil prenom={prenom} />
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
