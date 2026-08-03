/**
 * L'initiale d'un avatar.
 *
 * **Un seul système d'avatar** (`social.md` §3) : l'initiale sort du pseudo,
 * jamais du prénom. Le prénom est privé — il ne quitte pas l'appareil et le
 * serveur ne le diffuse à personne ; le pseudo est l'identité sociale, la
 * seule chose que les autres comptes voient.
 *
 * Le repli sur le prénom couvre l'unique surface où la règle ne s'applique
 * pas encore : sa propre pastille, avant qu'un pseudo n'existe. Ce n'est
 * pas un second système — c'est l'état pré-social, et il ne s'affiche que
 * chez soi. Aucune surface lue par un tiers ne passe ici sans pseudo :
 * `publicProfile()` n'en produit aucune.
 *
 * L'indexation n'est pas `value[0]` : sur une identité composée d'emoji ou
 * de caractères hors du plan de base, l'accès par unité UTF-16 coupe au
 * milieu d'une paire et rend un losange noir.
 */
export function avatarInitial(pseudo: string | null | undefined, fallback?: string): string {
  const source = pseudo ?? fallback ?? ''
  return [...source][0]?.toUpperCase() ?? ''
}
