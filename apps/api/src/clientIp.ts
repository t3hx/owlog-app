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
    if (candidate && !trustedProxies.includes(candidate)) return candidate
  }

  return fallback
}
