import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import type { Language } from '@/i18n'
import type { AuthFailure } from '@/ports/AuthGateway'
import { Logo } from '@/ui/components/Logo'
import { OAuthButtons } from '@/ui/components/OAuthButtons'
import { useSetting } from '@/ui/hooks/useSetting'
import { usePorts } from '@/ui/PortsProvider'
import { useSession } from '@/ui/session/SessionProvider'

/**
 * Connexion — écran 2 du handoff, deux phases d'une même card.
 *
 * Les fournisseurs sont Google et GitHub (gate D1.4) — ni Apple ni Discord,
 * que montrait le prototype. Ils vivent AU-DESSUS du champ e-mail, séparés
 * par un `ou` : l'OAuth est le chemin court, l'e-mail le chemin universel.
 * Sans secrets côté serveur, aucun bouton n'est rendu et la card se
 * re-centre sur l'e-mail — l'état de tout déploiement qui n'a pas encore
 * posé ses identifiants.
 *
 * Même card, deuxième état — pas une navigation : une route dédiée au code
 * perdrait l'adresse saisie, et l'utilisateur doit voir OÙ le code est
 * parti pour détecter une faute de frappe. D'où l'adresse rappelée, et
 * « corriger l'adresse » qui revient en phase 1 sans rien perdre.
 *
 * Le champ code est l'élément dominant : le moment est important, le champ
 * le dit. Auto-envoi à la sixième touche — le CTA n'est que le secours.
 * Le renvoi est freiné visiblement : un lien muet qui échoue en silence
 * produirait trois e-mails et de la méfiance.
 */
const CODE_LENGTH = 6

/** Délai avant que « renvoyer » ne redevienne actif, hors 429 explicite. */
const RESEND_COOLDOWN_S = 30

export function Login() {
  const { t, i18n } = useTranslation()
  const { auth } = usePorts()
  const session = useSession()
  const [, navigate] = useLocation()

  const [phase, setPhase] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AuthFailure | null>(null)
  const [resendIn, setResendIn] = useState(0)

  // La microcopie « union assumée » ne s'affiche que si des données
  // locales existent : promettre une fusion à un appareil vide est du bruit.
  const { value: firstName } = useSetting('firstName')
  const hasLocalData = firstName !== undefined

  const codeField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setInterval(() => setResendIn((left) => left - 1), 1_000)
    return () => clearInterval(timer)
  }, [resendIn])

  const language: Language = i18n.resolvedLanguage === 'en' ? 'en' : 'fr'
  const emailValid = /\S+@\S+\.\S+/.test(email.trim())

  async function sendLink() {
    if (!emailValid || busy) return
    setBusy(true)
    setFailure(null)

    const result = await auth.requestLink(email.trim(), language)
    setBusy(false)

    if (!result.ok) {
      setFailure(result.failure)
      if (result.failure.kind === 'rate-limited') {
        setPhase('code')
        setResendIn(result.failure.retryAfter)
      }
      return
    }

    setPhase('code')
    setCode('')
    setResendIn(RESEND_COOLDOWN_S)
    queueMicrotask(() => codeField.current?.focus())
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    await sendLink()
  }

  /** Normalise (espaces et tirets du collage) et auto-envoie à six chiffres. */
  function onCodeChange(raw: string) {
    const cleaned = raw.replace(/[\s-]/g, '').slice(0, CODE_LENGTH)
    setCode(cleaned)
    setFailure(null)
    if (cleaned.length === CODE_LENGTH) void verify(cleaned)
  }

  async function verify(candidate: string) {
    if (busy) return
    setBusy(true)
    setFailure(null)

    const result = await auth.verifyCode(email.trim(), candidate)
    setBusy(false)

    if (!result.ok) {
      // Cinq codes faux : le jeton est mort, y compris pour le lien.
      // Retour phase 1 avec message — plus rien à décompter ici.
      if (result.failure.kind === 'locked') setPhase('email')
      setFailure(result.failure)
      setCode('')
      return
    }

    await session.establish(result.value)
    navigate('/login/sync')
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    if (code.length === CODE_LENGTH) await verify(code)
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="px-6 py-5">
        <button
          type="button"
          aria-label={t('login.back')}
          onClick={() => navigate('/')}
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border-active bg-tabbar text-base text-text transition-colors hover:border-accent"
        >
          ←
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 pb-10">
        <div className="w-[420px] max-w-full rounded-sheet border border-border bg-surface-translucent p-8 shadow-[0_20px_60px_rgba(0,0,0,.45)]">
          <div className="flex flex-col items-center">
            <Logo className="h-56" />
            <p className="mt-2 font-mono text-[11px] text-muted">{t('login.tagline')}</p>
          </div>

          {phase === 'email' && (
            <OAuthButtons onFailed={() => setFailure({ kind: 'unavailable' })} />
          )}

          {phase === 'email' ? (
            <form onSubmit={submitEmail} className="mt-7 flex flex-col gap-3">
              <div className="flex items-center gap-2.5 rounded-action border border-border-accent bg-surface px-3.5 shadow-glow">
                <span aria-hidden className="font-mono text-[13px] text-accent">
                  ›
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('login.emailPlaceholder')}
                  autoComplete="email"
                  inputMode="email"
                  enterKeyHint="send"
                  className="h-12 w-full bg-transparent text-sm text-text outline-none placeholder:text-subtle"
                />
              </div>

              {hasLocalData && (
                <p className="font-mono text-[10px] leading-relaxed text-subtle">
                  {t('login.mergeNote')}
                </p>
              )}

              <button
                type="submit"
                disabled={!emailValid || busy}
                className="h-12 rounded-action bg-gradient-action font-display text-[13px] font-semibold tracking-[.5px] text-bg shadow-glow disabled:opacity-40 disabled:shadow-none"
              >
                {busy ? t('login.sending') : t('login.sendCta')}
              </button>

              <FailureNote failure={failure} />

              <p className="mt-1 text-center font-mono text-[9.5px] text-subtle">
                {t('login.legal')}
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode} className="mt-7 flex flex-col gap-3">
              <p className="text-center font-mono text-[10.5px] text-muted">
                {t('login.codeSentTo')} <span className="text-text">{email.trim()}</span>
              </p>

              <div className="flex items-center gap-2.5 rounded-action border border-border-accent bg-surface px-3.5 shadow-glow">
                <span aria-hidden className="font-mono text-[15px] text-accent">
                  ›
                </span>
                <input
                  ref={codeField}
                  value={code}
                  onChange={(event) => onCodeChange(event.target.value)}
                  placeholder="······"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="go"
                  aria-label={t('login.codeLabel')}
                  className="h-14 w-full bg-transparent text-center font-mono text-[21px] tracking-[.5em] text-text outline-none placeholder:text-subtle"
                />
              </div>

              <button
                type="submit"
                disabled={code.length < CODE_LENGTH || busy}
                className="h-12 rounded-action bg-gradient-action font-display text-[13px] font-semibold tracking-[.5px] text-bg shadow-glow disabled:opacity-40 disabled:shadow-none"
              >
                {busy ? t('login.verifying') : t('login.validate')}
              </button>

              <FailureNote failure={failure} />

              <div className="mt-1 flex flex-col items-center gap-2">
                {resendIn > 0 ? (
                  <span className="font-mono text-[10px] text-subtle">
                    {t('login.resendIn', { seconds: resendIn })}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void sendLink()}
                    disabled={busy}
                    className="min-h-0 font-mono text-[10px] text-accent disabled:opacity-40"
                  >
                    {t('login.resend')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPhase('email')
                    setCode('')
                    setFailure(null)
                  }}
                  className="min-h-0 font-mono text-[10px] text-muted"
                >
                  {t('login.fixEmail')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Sémantique d'erreur système : mono muted dans un encart, préfixe `!`.
 * Jamais de rouge — c'est la couleur du statut « abandonné », une couleur
 * de donnée, pas d'alarme.
 */
function FailureNote({ failure }: { failure: AuthFailure | null }) {
  const { t } = useTranslation()
  if (failure === null) return null

  const message = (() => {
    switch (failure.kind) {
      case 'invalid':
        return failure.attemptsLeft === undefined
          ? t('login.errorInvalid')
          : t('login.errorInvalidAttempts', { count: failure.attemptsLeft })
      case 'locked':
        return t('login.errorLocked')
      case 'rate-limited':
        return t('login.errorRateLimited')
      case 'offline':
        return t('login.errorOffline')
      case 'unavailable':
        return t('login.errorUnavailable')
    }
  })()

  return (
    <p
      role="alert"
      className="rounded-action border border-border bg-surface px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted"
    >
      ! {message}
    </p>
  )
}
