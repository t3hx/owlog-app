/**
 * Extraction de l'IP réelle du client.
 *
 * Le service tourne derrière deux couches : Cloudflare, puis le reverse
 * proxy de Dokploy. L'adresse que voit Hono est donc toujours celle du
 * proxy. Limiter le débit dessus reviendrait à **bannir tout le monde d'un
 * coup dès qu'un seul client dépasse** — le pire des deux mondes : la
 * protection ne protège pas, et elle coupe le service.
 *
 * L'ordre de confiance est délibéré :
 *
 * 1. `CF-Connecting-IP`, que Cloudflare pose lui-même et écrase toujours.
 *    C'est la seule valeur qu'un client ne peut pas forger quand le trafic
 *    passe réellement par Cloudflare.
 * 2. `X-Forwarded-For`, dont on prend la **dernière** entrée non fiable en
 *    partant de la droite, après avoir retiré les proxies connus. Prendre
 *    la première — le réflexe habituel — laisse n'importe qui usurper une
 *    IP en envoyant son propre en-tête.
 *
 * Sans proxies déclarés, on ne fait confiance à aucun en-tête : en
 * développement local, il n'y a pas de proxy, et accepter un en-tête
 * forgeable rendrait le limiteur trivialement contournable.
 *
 * Une entrée peut être une adresse exacte ou une **plage CIDR**. La plage
 * n'est pas un confort : sur Dokploy, l'adresse de Traefik est attribuée par
 * le réseau Docker et change quand le proxy est recréé. Une liste d'adresses
 * exactes est donc juste le jour du déploiement et fausse ensuite — et cette
 * dérive ne se signale pas, elle se contente de faire retomber tout le monde
 * dans le même seau de limitation.
 */
export function clientIp(options: {
  headers: Headers
  socketAddress: string | undefined
  trustedProxies: readonly string[]
}): string {
  const { headers, socketAddress, trustedProxies } = options
  const fallback = socketAddress ?? 'unknown'

  if (trustedProxies.length === 0) return fallback

  const cloudflare = headers.get('cf-connecting-ip')?.trim()
  if (cloudflare) return cloudflare

  const forwarded = headers.get('x-forwarded-for')
  if (!forwarded) return fallback

  const chain = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  // En partant de la droite, on saute les proxies connus. Le premier
  // inconnu rencontré est le client réel, ou le dernier proxy hors liste.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]
    if (candidate && !isTrusted(candidate, trustedProxies)) return candidate
  }

  return fallback
}

/** Vrai si l'adresse figure dans la liste, par égalité ou par plage. */
function isTrusted(address: string, trustedProxies: readonly string[]): boolean {
  return trustedProxies.some((entry) =>
    entry.includes('/') ? isInRange(address, entry) : entry === address,
  )
}

/**
 * Appartenance d'une adresse IPv4 à une plage CIDR.
 *
 * IPv4 seulement : les réseaux Docker de Dokploy le sont, et une adresse
 * IPv6 confrontée à une plage IPv4 doit répondre « non », pas « peut-être ».
 *
 * Une entrée mal formée — faute de frappe dans Doppler — rend `false`. Une
 * liste de confiance qui échoue doit se fermer, jamais s'ouvrir : la
 * conséquence d'un refus est une limitation trop stricte, celle d'une
 * acceptation est un limiteur contournable.
 */
function isInRange(address: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split('/')
  const prefix = Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false

  const target = toIpv4Int(address)
  const base = toIpv4Int(network ?? '')
  if (target === null || base === null) return false

  // Un préfixe de 0 couvre tout ; le décalage de 32 bits en JavaScript
  // équivaut à un décalage de 0, il faut donc traiter ce cas à part.
  if (prefix === 0) return true

  const mask = (-1 << (32 - prefix)) >>> 0
  return ((target & mask) >>> 0) === ((base & mask) >>> 0)
}

/** Adresse IPv4 pointée vers son entier non signé, ou `null` si ce n'en est pas une. */
function toIpv4Int(address: string): number | null {
  const octets = address.split('.')
  if (octets.length !== 4) return null

  let value = 0
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null
    const number = Number(octet)
    if (number > 255) return null
    value = value * 256 + number
  }

  return value
}
