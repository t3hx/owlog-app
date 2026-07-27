import { useState, type FormEvent } from 'react'

import { Logo } from '@/ui/components/Logo'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Écran de première ouverture.
 *
 * Cet écran ne figure pas dans le handoff : il est l'un des quatre à
 * dessiner, et il applique la prémisse P6 du plan — l'état vide est une
 * fonctionnalité, pas un écran par défaut. Rien n'est préchargé, donc c'est
 * le premier écran que voit un utilisateur, et c'est lui qui décide s'il
 * reste.
 *
 * Il fait trois choses, dans cet ordre :
 *
 * 1. Il explique ce qui va se passer. Un tracker vide ne se comprend pas de
 *    lui-même, et la thèse du produit — le visionnage comme unité, pas le
 *    film — n'est visible nulle part tant qu'il n'y a pas de données.
 * 2. Il demande le prénom. Une seule question, écrite dans `settings`, qui
 *    alimente le « Bonsoir {prénom} » de l'accueil sans authentification.
 *    Le handoff prévoyait un compte ; le temps 1 est local, cette question
 *    le remplace.
 * 3. Il donne une action évidente.
 *
 * Composition reprise du handoff : eyebrow mono menthe, titre Chakra Petch,
 * champ à bordure accent avec préfixe `›`, CTA plein dégradé, microcopie
 * mono. Ce sont les codes de l'écran de connexion, réemployés parce que
 * c'est le même moment du parcours.
 */
export function Bienvenue() {
  const { settings } = usePorts()
  const [prenom, setPrenom] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const valide = prenom.trim().length > 0

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault()
    if (!valide || envoi) return

    setEnvoi(true)
    await settings.ecrire('prenom', prenom.trim())
    // Pas de remise à zéro de `envoi` : l'écriture fait disparaître cet
    // écran. Le remettre à false ferait clignoter le bouton avant le
    // démontage du composant.
  }

  return (
    <section className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-7 px-6 py-10">
      <header className="flex flex-col gap-4">
        <Logo />
        <p className="font-mono text-[11px] tracking-wide text-accent">
          // PREMIÈRE OUVERTURE
        </p>
        <h1 className="font-display text-[25px] font-semibold leading-tight text-text">
          Ton <span className="text-gradient-action">log</span> est vide.
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          Chaque titre que tu ajoutes écrit une ligne datée. Chaque fois que tu
          revois quelque chose, c&apos;est un visionnage de plus, avec sa propre
          date et sa propre note. Au bout d&apos;un moment, tu ne regardes plus
          une liste : tu relis ton histoire.
        </p>
      </header>

      <form onSubmit={soumettre} className="flex flex-col gap-3">
        <label htmlFor="prenom" className="font-mono text-[10px] text-subtle">
          on t&apos;appelle comment ?
        </label>

        <div className="flex items-center gap-2 rounded-action border border-border-accent bg-surface px-3 shadow-glow">
          <span aria-hidden className="font-mono text-sm text-accent">
            ›
          </span>
          <input
            id="prenom"
            name="prenom"
            type="text"
            value={prenom}
            onChange={(evenement) => setPrenom(evenement.target.value)}
            autoComplete="given-name"
            enterKeyHint="go"
            maxLength={40}
            placeholder="ton prénom"
            className="h-11 w-full bg-transparent text-[15px] text-text outline-none placeholder:text-subtle"
          />
        </div>

        <button
          type="submit"
          disabled={!valide || envoi}
          className="h-11 rounded-action bg-gradient-action font-display text-sm font-bold tracking-wide text-bg shadow-glow disabled:opacity-40 disabled:shadow-none"
        >
          COMMENCER
        </button>

        <p className="font-mono text-[10px] leading-relaxed text-subtle">
          reste sur cet appareil · aucun compte · données exportables
        </p>
      </form>
    </section>
  )
}
