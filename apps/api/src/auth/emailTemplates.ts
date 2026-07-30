import type { MailMessage } from '../mail/mailer.ts'

/**
 * Gabarit de l'e-mail de connexion — une surface de design, pas un détail
 * d'adaptateur (spec `docs/design_handoff_owlog/reglages.md`, surface 5).
 *
 * Le CODE d'abord, gros, mono ; le lien en secours dessous. Le cas
 * dominant est le va-et-vient Mail → PWA sur le même appareil : on
 * retient six chiffres, on ne clique pas. Le code figure aussi dans
 * l'objet : lisible en notification, sans ouvrir le message.
 *
 * HTML monocolonne, styles inline, sans images, fond neutre : les clients
 * mail ne rendent ni fonts web ni thème sombre fiablement — on ne
 * reproduit pas le thème nocturne, on reste lisible partout.
 */
export type EmailLanguage = 'fr' | 'en'

export interface LoginEmailInput {
  readonly to: string
  readonly code: string
  readonly link: string
  readonly language: EmailLanguage
}

const COPY = {
  fr: {
    subject: (code: string) => `${code} — ton code de connexion Owlog`,
    intro: 'Ton code de connexion :',
    fallback: 'Ou clique :',
    footer:
      "Le code et le lien expirent dans 15 minutes. Si ce n'était pas toi, ignore ce message.",
  },
  en: {
    subject: (code: string) => `${code} — your Owlog sign-in code`,
    intro: 'Your sign-in code:',
    fallback: 'Or click:',
    footer: "The code and the link expire in 15 minutes. If this wasn't you, ignore this message.",
  },
} as const

export function loginEmail({ to, code, link, language }: LoginEmailInput): MailMessage {
  const copy = COPY[language]

  const text = [copy.intro, '', code, '', `${copy.fallback} ${link}`, '', copy.footer].join('\n')

  const html = [
    '<div style="max-width:420px;margin:0 auto;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a">',
    `<p style="font-size:14px;margin:0 0 16px">${copy.intro}</p>`,
    `<p style="font-family:'Courier New',monospace;font-size:36px;font-weight:bold;letter-spacing:6px;margin:0 0 24px">${code}</p>`,
    `<p style="font-size:13px;margin:0 0 24px">${copy.fallback} <a href="${link}">${link}</a></p>`,
    `<p style="font-size:12px;color:#6a6a6a;margin:0">${copy.footer}</p>`,
    '</div>',
  ].join('')

  return { to, subject: copy.subject(code), text, html }
}
