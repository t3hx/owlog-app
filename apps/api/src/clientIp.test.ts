import { describe, expect, it } from 'vitest'

import { clientIp } from './clientIp.ts'

/**
 * Extraction de l'IP réelle.
 *
 * C'est la fonction dont dépend toute la justesse de la limitation de débit.
 * Se tromper ici n'échoue jamais bruyamment : soit on limite tout le monde
 * sur l'adresse du proxy — le premier utilisateur qui dépasse coupe le
 * service pour tous — soit on croit un en-tête forgeable et le limiteur se
 * contourne en une ligne de `curl`.
 */

function headersOf(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

describe('clientIp', () => {
  it("ne croit aucun en-tête quand aucun proxy n'est déclaré", () => {
    // En développement local il n'y a pas de proxy. Accepter un en-tête
    // rendrait le limiteur trivialement contournable.
    const ip = clientIp({
      headers: headersOf({ 'cf-connecting-ip': '9.9.9.9' }),
      socketAddress: '127.0.0.1',
      trustedProxies: [],
    })

    expect(ip).toBe('127.0.0.1')
  })

  it('préfère CF-Connecting-IP, que Cloudflare écrase toujours', () => {
    const ip = clientIp({
      headers: headersOf({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.1',
      }),
      socketAddress: '10.0.1.7',
      trustedProxies: ['10.0.1.7'],
    })

    expect(ip).toBe('203.0.113.7')
  })

  it('lit X-Forwarded-For depuis la droite, en sautant les proxies connus', () => {
    // Prendre la première entrée — le réflexe habituel — laisse n'importe
    // qui usurper une IP en envoyant son propre en-tête.
    const ip = clientIp({
      headers: headersOf({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 10.0.1.7' }),
      socketAddress: '10.0.1.7',
      trustedProxies: ['10.0.1.7'],
    })

    expect(ip).toBe('203.0.113.7')
  })

  it("retombe sur l'adresse de socket quand la chaîne n'est que des proxies", () => {
    const ip = clientIp({
      headers: headersOf({ 'x-forwarded-for': '10.0.1.7' }),
      socketAddress: '10.0.1.7',
      trustedProxies: ['10.0.1.7'],
    })

    expect(ip).toBe('10.0.1.7')
  })

  describe('plages CIDR', () => {
    // Sur Dokploy, l'adresse de Traefik est attribuée par le réseau Docker
    // et change quand le proxy est recréé. Une liste d'IP exactes est donc
    // juste le jour du déploiement et fausse ensuite, sans rien signaler.
    it('reconnaît un proxy par sa plage plutôt que par son adresse', () => {
      const ip = clientIp({
        headers: headersOf({ 'x-forwarded-for': '203.0.113.7, 10.0.42.19' }),
        socketAddress: '10.0.42.19',
        trustedProxies: ['10.0.0.0/8'],
      })

      expect(ip).toBe('203.0.113.7')
    })

    it('active la confiance aux en-têtes, comme une IP exacte le ferait', () => {
      const ip = clientIp({
        headers: headersOf({ 'cf-connecting-ip': '203.0.113.7' }),
        socketAddress: '172.18.0.3',
        trustedProxies: ['172.16.0.0/12'],
      })

      expect(ip).toBe('203.0.113.7')
    })

    it('exclut une adresse hors de la plage', () => {
      const ip = clientIp({
        headers: headersOf({ 'x-forwarded-for': '203.0.113.7, 192.0.2.5' }),
        socketAddress: '10.0.42.19',
        trustedProxies: ['10.0.0.0/8'],
      })

      // 192.0.2.5 n'est pas dans 10.0.0.0/8 : c'est lui le dernier maillon
      // non fiable, donc l'IP retenue.
      expect(ip).toBe('192.0.2.5')
    })

    it('respecte la frontière du masque', () => {
      const inside = clientIp({
        headers: headersOf({ 'x-forwarded-for': '203.0.113.7, 10.0.1.255' }),
        socketAddress: '10.0.1.255',
        trustedProxies: ['10.0.1.0/24'],
      })
      const outside = clientIp({
        headers: headersOf({ 'x-forwarded-for': '203.0.113.7, 10.0.2.1' }),
        socketAddress: '10.0.2.1',
        trustedProxies: ['10.0.1.0/24'],
      })

      expect(inside).toBe('203.0.113.7')
      expect(outside).toBe('10.0.2.1')
    })

    it('mélange plages et adresses exactes', () => {
      const ip = clientIp({
        headers: headersOf({ 'x-forwarded-for': '203.0.113.7, 192.0.2.5, 10.0.42.19' }),
        socketAddress: '10.0.42.19',
        trustedProxies: ['10.0.0.0/8', '192.0.2.5'],
      })

      expect(ip).toBe('203.0.113.7')
    })

    it('ignore une plage mal formée plutôt que de la croire', () => {
      // Une faute de frappe dans Doppler ne doit pas ouvrir la confiance :
      // l'entrée est inerte, pas permissive.
      const ip = clientIp({
        headers: headersOf({ 'x-forwarded-for': '203.0.113.7, 10.0.42.19' }),
        socketAddress: '10.0.42.19',
        trustedProxies: ['10.0.0.0/99'],
      })

      expect(ip).toBe('10.0.42.19')
    })

    it("ne fait pas correspondre une IPv6 à une plage IPv4", () => {
      const ip = clientIp({
        headers: headersOf({ 'x-forwarded-for': '203.0.113.7, ::1' }),
        socketAddress: '::1',
        trustedProxies: ['10.0.0.0/8'],
      })

      expect(ip).toBe('::1')
    })
  })
})
