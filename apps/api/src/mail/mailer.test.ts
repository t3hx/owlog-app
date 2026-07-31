import { describe, expect, it, vi } from 'vitest'

import { createHttpMailer } from './mailer.ts'

/**
 * L'adaptateur HTTP du port Mailer.
 *
 * Zéro dépendance npm : un POST vers l'API du fournisseur, c'est tout.
 * Ce qui se teste : la forme exacte de la requête, et le refus de
 * considérer un non-2xx comme un envoi réussi.
 */
const MESSAGE = {
  to: 'a@b.c',
  subject: '123456 — ton code de connexion Owlog',
  text: 'code : 123456',
  html: '<p>123456</p>',
}

describe('createHttpMailer', () => {
  it("poste le message au fournisseur, jeton en Authorization", async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    const mailer = createHttpMailer({
      apiUrl: 'https://api.mail.test/emails',
      apiToken: 'secret-token',
      from: 'Owlog <no-reply@owlog.test>',
      fetchFn,
    })

    await mailer.send(MESSAGE)

    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.mail.test/emails')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret-token')
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Owlog <no-reply@owlog.test>',
      to: 'a@b.c',
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    })
  })

  it("un non-2xx est une erreur, jamais un envoi réussi", async () => {
    const fetchFn = vi.fn(async () => new Response('quota exceeded', { status: 429 }))
    const mailer = createHttpMailer({
      apiUrl: 'https://api.mail.test/emails',
      apiToken: 'secret-token',
      from: 'no-reply@owlog.test',
      fetchFn,
    })

    await expect(mailer.send(MESSAGE)).rejects.toThrow(/429/)
  })
})
