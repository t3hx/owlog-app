import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useSearch } from 'wouter'

/**
 * Atterrissage du lien magique — `/login/link?token=…`.
 *
 * **Le lien ne se consomme JAMAIS au GET.** Les scanners d'e-mail
 * (SafeLinks, antivirus) pré-visitent les liens et brûleraient un jeton à
 * usage unique avant l'humain. La page se charge, PUIS fait le POST —
 * l'état « en cours » est réel, pas cosmétique.
 *
 * Trois états, codes de `Welcome` (eyebrow mono, titre Chakra Petch,
 * corps muted). L'échec n'est jamais un cul-de-sac : le CTA renvoie vers
 * `/login` pour recevoir un nouveau code.
 */
import { usePorts } from '@/ui/PortsProvider'
import { useSession } from '@/ui/session/SessionProvider'

export function LoginLink() {
  const { t } = useTranslation()
  const { auth } = usePorts()
  const session = useSession()
  const [, navigate] = useLocation()
  const search = useSearch()

  const [state, setState] = useState<'pending' | 'connected' | 'failed'>('pending')

  // StrictMode monte deux fois : sans cette garde, le second POST
  // trouverait un jeton déjà consommé et afficherait « expiré » à tort.
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    const token = new URLSearchParams(search).get('token') ?? ''
    if (token === '') {
      setState('failed')
      return
    }

    void auth.verifyLink(token).then(async (result) => {
      if (!result.ok) {
        setState('failed')
        return
      }
      setState('connected')
      await session.establish(result.value)
      navigate('/login/sync')
    })
  }, [auth, session, navigate, search])

  return (
    <section className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-10">
      <p className="font-mono text-[11px] tracking-wide text-accent">
        {t('loginLink.eyebrow')}
      </p>

      {state === 'pending' && (
        <>
          <h1 className="font-display text-[25px] font-semibold leading-tight text-text">
            {t('loginLink.pendingTitle')}
          </h1>
          <p className="text-sm leading-relaxed text-muted">{t('loginLink.pendingBody')}</p>
        </>
      )}

      {state === 'connected' && (
        <>
          <h1 className="font-display text-[25px] font-semibold leading-tight text-text">
            <span aria-hidden className="text-accent">
              ✓{' '}
            </span>
            {t('loginLink.connectedTitle')}
          </h1>
          <p className="text-sm leading-relaxed text-muted">{t('loginLink.connectedBody')}</p>
        </>
      )}

      {state === 'failed' && (
        <>
          <h1 className="font-display text-[25px] font-semibold leading-tight text-text">
            {t('loginLink.failedTitle')}
          </h1>
          <p
            role="alert"
            className="rounded-action border border-border bg-surface px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted"
          >
            ! {t('loginLink.failedBody')}
          </p>
          <Link
            href="/login"
            className="mt-2 flex h-11 items-center justify-center rounded-action border border-border-active font-display text-[13px] font-semibold tracking-[.5px] text-text transition-colors hover:border-accent"
          >
            {t('loginLink.newCode')}
          </Link>
        </>
      )}
    </section>
  )
}
