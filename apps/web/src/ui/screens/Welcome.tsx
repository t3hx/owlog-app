import { useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Attribution } from '@/ui/components/Attribution'
import { usePorts } from '@/ui/PortsProvider'
import { useSession } from '@/ui/session/SessionProvider'

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
export function Welcome() {
  const { t } = useTranslation()
  const { settings, auth } = usePorts()
  const session = useSession()
  const [firstName, setPrenom] = useState('')
  const [submitting, setEnvoi] = useState(false)

  const valid = firstName.trim().length > 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || submitting) return

    setEnvoi(true)
    await settings.write('firstName', firstName.trim())
    // Connecté sans prénom serveur — l'appareil vierge qui vient de se
    // connecter : la réponse de l'onboarding vaut upsert, le serveur fait
    // autorité. Sans attendre ni bloquer : hors réseau, la prochaine
    // édition des Réglages retentera.
    if (session.user !== null) void auth.updateProfile(firstName.trim())
    // Pas de remise à zéro de `submitting` : l'écriture fait disparaître cet
    // écran. Le remettre à false ferait clignoter le bouton avant le
    // démontage du composant.
  }

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-md flex-col justify-center gap-7 px-6 py-10">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-[11px] tracking-wide text-accent">
          {t('welcome.eyebrow')}
        </p>
        <h1 className="font-display text-[25px] font-semibold leading-tight text-text">
          <Trans
            i18nKey="welcome.title"
            components={[<span key="log" className="text-gradient-action" />]}
          />
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          {t('welcome.body')}
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="firstName" className="font-mono text-[10px] text-subtle">
          {t('welcome.firstNameLabel')}
        </label>

        <div className="flex items-center gap-2 rounded-action border border-border-accent bg-surface px-3 shadow-glow">
          <span aria-hidden className="font-mono text-sm text-accent">
            ›
          </span>
          <input
            id="firstName"
            name="firstName"
            type="text"
            value={firstName}
            onChange={(event) => setPrenom(event.target.value)}
            autoComplete="given-name"
            enterKeyHint="go"
            maxLength={40}
            placeholder={t('welcome.firstNamePlaceholder')}
            className="h-11 w-full bg-transparent text-[15px] text-text outline-none placeholder:text-subtle"
          />
        </div>

        <button
          type="submit"
          disabled={!valid || submitting}
          className="h-11 rounded-action bg-gradient-action font-display text-sm font-bold tracking-wide text-bg shadow-glow disabled:opacity-40 disabled:shadow-none"
        >
          {t('welcome.submit')}
        </button>

        <p className="font-mono text-[10px] leading-relaxed text-subtle">
          {t('welcome.legal')}
        </p>
      </form>

      <Attribution />
    </section>
  )
}
