/**
 * Port d'envoi d'e-mails.
 *
 * Un port et deux adaptateurs, zéro dépendance npm : l'envoi est un POST
 * HTTP vers l'API du fournisseur (format Resend — `{from, to, subject,
 * html, text}` avec jeton Bearer), et le développement local se contente
 * de la console. Le jour où le fournisseur change, c'est une URL et un
 * jeton dans Doppler, pas une bibliothèque.
 */
export interface MailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

export interface HttpMailerOptions {
  readonly apiUrl: string
  readonly apiToken: string
  /** Expéditeur, tel que le fournisseur l'attend : `Owlog <no-reply@…>`. */
  readonly from: string
  /** Injectable pour les tests, qui ne doivent appeler personne. */
  readonly fetchFn?: typeof fetch
}

export function createHttpMailer(options: HttpMailerOptions): Mailer {
  const { apiUrl, apiToken, from, fetchFn = fetch } = options

  return {
    async send(message) {
      const response = await fetchFn(apiUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })

      if (!response.ok) {
        // Le corps d'erreur du fournisseur aide au diagnostic, mais borné :
        // pas question de logguer un document entier.
        const detail = (await response.text().catch(() => '')).slice(0, 200)
        throw new Error(`mail provider answered ${response.status}: ${detail}`)
      }
    },
  }
}

/**
 * Mailer de développement : le message part dans la console.
 *
 * C'est ce qui permet de dérouler le parcours complet — demande, code,
 * lien — sans fournisseur configuré. Le préfixe est bruyant à dessein :
 * personne ne doit croire qu'un e-mail est réellement parti.
 */
export function createConsoleMailer(log: (message: string) => void = console.log): Mailer {
  return {
    async send(message) {
      log(
        `[mail:console — AUCUN E-MAIL ENVOYÉ]\nto: ${message.to}\nsubject: ${message.subject}\n${message.text}`,
      )
    },
  }
}
