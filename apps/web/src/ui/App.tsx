import { useTranslation } from 'react-i18next'
import { Route, Switch, useRoute } from 'wouter'

import { UnderConstruction } from '@/ui/components/UnderConstruction'
import { Header } from '@/ui/components/Header'
import { TabBar } from '@/ui/components/TabBar'
import { UpdateBanner } from '@/ui/components/UpdateBanner'
import { useSetting } from '@/ui/hooks/useSetting'
import { Home } from '@/ui/screens/Home'
import { Library } from '@/ui/screens/Library'
import { Log } from '@/ui/screens/Log'
import { Media } from '@/ui/screens/Media'
import { Welcome } from '@/ui/screens/Welcome'
import { Debug } from '@/ui/screens/Debug'

/**
 * Racine de l'application.
 *
 * Routing en mode history, pas en hash. Ce choix impose deux choses en aval,
 * toutes deux traitées à l'étape 3 : un rewrite SPA dans le Caddyfile pour
 * que `/library` serve `index.html`, et `navigateFallback` dans la
 * configuration Workbox pour que la même règle vaille hors-ligne.
 *
 * Tant que le prénom n'est pas renseigné, l'écran de bienvenue occupe toute
 * la vue, sans tab bar : à la première ouverture il n'y a rien à naviguer,
 * et quatre onglets vides donneraient l'impression d'une app cassée plutôt
 * que d'une app neuve.
 */
export function App() {
  const { t } = useTranslation()
  const { value: firstName, loading } = useSetting('firstName')
  const [onDebug] = useRoute('/debug')

  // `/debug` passe avant la question du prénom. Un écran de diagnostic
  // qu'on ne peut ouvrir qu'après l'onboarding est inutile précisément
  // quand l'onboarding est ce qui ne marche pas.
  if (onDebug) {
    return <Debug />
  }

  // Premier rendu : on ne sait pas encore si le prénom existe. Afficher
  // l'écran de bienvenue tout de suite le ferait clignoter à chaque
  // ouverture, y compris pour quelqu'un qui l'a déjà renseigné.
  if (loading) {
    return <div className="min-h-dvh" />
  }

  if (firstName === undefined) {
    return (
      <>
        <Header />
        <Welcome />
      </>
    )
  }

  return (
    <div className="min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <Header />

      <Switch>
        <Route path="/">
          <Home firstName={firstName} />
        </Route>
        <Route path="/media/:kind/:id">
          {(params) => <Media ref={`tmdb:${params.kind === 'tv' ? 'tv' : 'movie'}/${Number(params.id)}`} />}
        </Route>
        <Route path="/library">
          <Library />
        </Route>
        <Route path="/log">
          <Log />
        </Route>
        <Route path="/stats">
          <UnderConstruction
            title={t('stats.title')}
            step={11}
            what={t('stats.what')}
          />
        </Route>
        <Route>
          <UnderConstruction
            title={t('notFound.title')}
            step={1}
            what={t('notFound.what')}
          />
        </Route>
      </Switch>

      <UpdateBanner />
      <TabBar />
    </div>
  )
}
