/**
 * Racine de l'application.
 *
 * À l'étape 1 du plan, elle ne porte que le socle : le shell et la navigation
 * arrivent dans le même lot, l'état vide juste après. Aucune donnée n'est lue
 * ni écrite ici — tout passe par les ports (voir CLAUDE.md).
 */
export function App() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg text-text">
      <p className="font-mono text-xs text-muted">owlog</p>
    </main>
  )
}
