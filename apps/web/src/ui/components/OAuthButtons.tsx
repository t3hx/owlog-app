import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OAuthProvider } from '@owlog/contracts'

import { usePorts } from '@/ui/PortsProvider'

/**
 * Les deux surfaces de connexion par fournisseur — écran 2, amendement
 * `social.md` §5.
 *
 * **Le prototype montrait Google / Apple / Discord ; le gate D1.4 acte
 * Google et GitHub.** Ni Apple ni Discord : pas de case fantôme.
 *
 * Rien n'est rendu tant que le serveur n'a pas dit quels fournisseurs il
 * sait honorer. C'est la dégradation douce du temps 2 : sans secrets, la
 * card se re-centre sur l'e-mail comme si l'OAuth n'existait pas. Un bouton
 * qui mène à une erreur de configuration est pire qu'un bouton absent —
 * l'utilisateur croit avoir un chemin, et il n'en a pas.
 *
 * Icônes **monochromes**, couleur `text` : les couleurs de marque
 * casseraient la palette nocturne, et c'est une règle du handoff, pas un
 * goût.
 */
export function OAuthButtons({ onFailed }: { readonly onFailed: () => void }) {
  const { t } = useTranslation()
  const { auth } = usePorts()
  const [providers, setProviders] = useState<readonly OAuthProvider[]>([])
  const [busy, setBusy] = useState<OAuthProvider | null>(null)

  useEffect(() => {
    let cancelled = false
    void auth.oauthProviders().then((result) => {
      if (!cancelled && result.ok) setProviders(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [auth])

  if (providers.length === 0) return null

  const go = async (provider: OAuthProvider) => {
    setBusy(provider)
    const result = await auth.oauthBegin(provider)
    if (!result.ok) {
      setBusy(null)
      onFailed()
      return
    }
    // Navigation complète et non `fetch` : c'est le fournisseur qui doit
    // recevoir l'utilisateur, avec ses cookies et sa barre d'adresse — une
    // page d'autorisation dans une iframe serait un hameçonnage.
    window.location.assign(result.value.url)
  }

  return (
    <div className="mt-7 flex flex-col gap-3">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          disabled={busy !== null}
          onClick={() => void go(provider)}
          className="flex h-12 items-center justify-center gap-2.5 rounded-action border border-border bg-surface text-[13.5px] text-text transition-colors hover:border-border-accent disabled:opacity-40"
        >
          <ProviderMark provider={provider} />
          {t(`login.continueWith.${provider}` as 'login.continueWith.google')}
        </button>
      ))}

      <p className="text-center font-mono text-[10px] text-subtle">{t('login.or')}</p>
    </div>
  )
}

/**
 * Le glyphe d'un fournisseur, dessiné en `currentColor`.
 *
 * Deux tracés minimaux plutôt que les logos officiels : ceux-ci sont
 * multicolores, soumis à des règles de marque, et arriveraient en fichiers
 * binaires — alors que le projet n'a aucun asset et que le handoff impose
 * du monochrome.
 */
function ProviderMark({ provider }: { readonly provider: OAuthProvider }) {
  if (provider === 'github') {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className="size-[18px] fill-current">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    )
  }

  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-[18px] fill-current">
      <path d="M12 2a10 10 0 1 0 9.83 11.9h-9.4v-3.4h9.9A10 10 0 0 0 12 2Zm0 3a7 7 0 1 1-4.9 12 7 7 0 0 1 4.9-12Z" />
    </svg>
  )
}
