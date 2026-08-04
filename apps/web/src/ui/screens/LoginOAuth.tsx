import { isOAuthProvider } from '@owlog/contracts'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useSearchParams } from 'wouter'

import type { AuthFailure } from '@/ports/AuthGateway'
import { usePorts } from '@/ui/PortsProvider'
import { useSession } from '@/ui/session/SessionProvider'

/**
 * Retour du fournisseur — `/login/oauth/:provider?code=&state=`.
 *
 * **C'est le web qui reçoit le callback, pas l'API** (décision eng F-4.2) :
 * une redirection est une navigation top-level, elle ne porte aucun en-tête,
 * donc pas le jeton partagé qu'exige `/auth/*`. Cet écran fait ce que fait
 * la page d'atterrissage du lien magique — il POSTe en `fetch` même-origine
 * ce que l'URL lui a donné.
 *
 * L'échange part **une fois**, dans un effet gardé : en `StrictMode`, React
 * monte deux fois en développement, et un code d'autorisation est à usage
 * unique — le second envoi échouerait, effaçant une connexion réussie par
 * un message d'erreur.
 *
 * Un refus ne laisse jamais bloqué : on revient à la card de connexion avec
 * un encart, et le message du cas « e-mail non vérifié » dit quoi faire.
 */
export function LoginOAuth({ provider }: { readonly provider: string }) {
  const { t } = useTranslation()
  const { auth } = usePorts()
  const session = useSession()
  const [, navigate] = useLocation()
  const [params] = useSearchParams()
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const started = useRef(false)

  const code = params.get('code')
  const state = params.get('state')
  const providerError = params.get('error')

  useEffect(() => {
    if (started.current) return
    started.current = true

    // Le fournisseur peut refuser avant même de nous rendre un code —
    // l'utilisateur a cliqué « annuler » sur son écran de consentement.
    if (providerError || !isOAuthProvider(provider) || !code || !state) {
      setFailure({ kind: 'invalid' })
      return
    }

    void auth.oauthComplete(provider, { code, state }).then(async (result) => {
      if (!result.ok) {
        setFailure(result.failure)
        return
      }
      await session.establish(result.value)
      navigate('/login/sync', { replace: true })
    })
  }, [auth, code, navigate, provider, providerError, session, state])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-[10px] tracking-wide text-accent">{t('loginLink.eyebrow')}</p>

      {failure === null ? (
        <p className="font-display text-[21px] font-semibold text-text">
          {t('loginOauth.pending')}
        </p>
      ) : (
        <>
          <p className="font-display text-[21px] font-semibold text-text">
            {t('loginOauth.failedTitle')}
          </p>
          <p className="max-w-sm text-sm text-muted">
            {failure.kind === 'oauth-unverified-email'
              ? t('loginOauth.unverified')
              : t('loginOauth.failedBody')}
          </p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="rounded-action border border-border-active px-5 font-mono text-[11px] text-muted"
          >
            {t('loginOauth.back')}
          </button>
        </>
      )}
    </div>
  )
}
