import { useTranslation } from 'react-i18next'
import { Redirect, Route, Switch, useRoute } from 'wouter'

import { UnderConstruction } from '@/ui/components/UnderConstruction'
import { Banners } from '@/ui/components/Banners'
import { Header } from '@/ui/components/Header'
import { Sidebar } from '@/ui/components/Sidebar'
import { TabBar } from '@/ui/components/TabBar'
import { useDesktop } from '@/ui/hooks/useDesktop'
import { useSetting } from '@/ui/hooks/useSetting'
import { Friends } from '@/ui/screens/Friends'
import { Home } from '@/ui/screens/Home'
import { Landing } from '@/ui/screens/Landing'
import { Library } from '@/ui/screens/Library'
import { Log } from '@/ui/screens/Log'
import { Login } from '@/ui/screens/Login'
import { LoginLink } from '@/ui/screens/LoginLink'
import { FirstPull } from '@/ui/screens/FirstPull'
import { Settings } from '@/ui/screens/Settings'
import { Stats } from '@/ui/screens/Stats'
import { Media } from '@/ui/screens/Media'
import { Welcome } from '@/ui/screens/Welcome'
import { Debug } from '@/ui/screens/Debug'

/**
 * Racine de l'application — le routage à trois états.
 *
 * ```
 * visiteur sans rien   → Landing (et « COMMENCER » → onboarding LOCAL)
 * données locales      → l'app, directement — la Landing ne s'interpose
 *                        JAMAIS devant un utilisateur existant
 * parcours de compte   → /login, /login/link, /login/sync : plein écran,
 *                        accessibles dans tous les états
 * ```
 *
 * Le gate de boot : la présence de données se lit dans IndexedDB, qui est
 * asynchrone. Tant qu'on ne sait pas, on rend un écran neutre — jamais un
 * flash de Landing pour l'utilisateur existant, jamais un clignotement de
 * Welcome pour celui qui a déjà un prénom.
 *
 * Routing en mode history, pas en hash. Ce choix impose deux choses en
 * aval, toutes deux en place : un rewrite SPA dans le Caddyfile pour que
 * `/library` serve `index.html`, et `navigateFallback` côté Workbox pour
 * que la même règle vaille hors-ligne.
 *
 * Le palier desktop ne change que le chrome :
 *
 * ```
 * < 1024px   Header en haut  ·  TabBar en bas   (colonne, centrée dès 640px)
 * ≥ 1024px   Sidebar à gauche ·  ni Header ni TabBar
 * ```
 *
 * Le `Switch` occupe la même place dans l'arbre des deux côtés du palier, et
 * son conteneur existe toujours. C'est délibéré : le remonter à la traversée
 * viderait la recherche en cours et remettrait le scroll à zéro sur un simple
 * redimensionnement de fenêtre.
 */
export function App() {
  const { t } = useTranslation()
  const desktop = useDesktop()
  const { value: firstName, loading } = useSetting('firstName')
  const [onDebug] = useRoute('/debug')
  const [onLogin] = useRoute('/login')
  const [onLoginLink] = useRoute('/login/link')
  const [onLoginSync] = useRoute('/login/sync')
  const [onWelcome] = useRoute('/welcome')

  // `/debug` passe avant toute question : un écran de diagnostic qu'on ne
  // peut ouvrir qu'après l'onboarding est inutile précisément quand
  // l'onboarding est ce qui ne marche pas.
  if (onDebug) return <Debug />

  // Le parcours de compte est plein écran et vaut dans tous les états —
  // l'utilisateur local qui active la sync comme l'appareil vierge.
  if (onLoginLink) return <LoginLink />
  if (onLoginSync) return <FirstPull />
  if (onLogin) return <Login />

  // Le gate de boot : on ne sait pas encore. Écran neutre, pas de flash.
  if (loading) return <div className="min-h-dvh" />

  if (onWelcome) {
    return firstName === undefined ? <Welcome /> : <Redirect to="/" replace />
  }

  // Aucune donnée locale : quel que soit le chemin demandé, la Landing est
  // le seul écran qui ait un sens.
  if (firstName === undefined) return <Landing />

  return (
    <div
      className={
        desktop ? 'flex min-h-dvh' : 'min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))]'
      }
    >
      {desktop && <Sidebar />}

      <div className={desktop ? 'min-w-0 flex-1 px-10 py-7' : undefined}>
        {!desktop && <Header />}

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
          <Route path="/friends">
            <Friends />
          </Route>
          <Route path="/stats">
            <Stats />
          </Route>
          <Route path="/settings">
            <Settings />
          </Route>
          <Route>
            <UnderConstruction
              title={t('notFound.title')}
              step={1}
              what={t('notFound.what')}
            />
          </Route>
        </Switch>
      </div>

      <Banners />
      {!desktop && <TabBar />}
    </div>
  )
}
