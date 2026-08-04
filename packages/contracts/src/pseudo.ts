/**
 * Format d'un pseudo : 3 à 20 caractères, minuscules, chiffres et `_`.
 *
 * **Unique domicile de la règle.** Le champ de Réglages force les
 * minuscules à la saisie, la route valide, et la base porte la même
 * expression en contrainte `CHECK` — les trois lisent cette constante ou la
 * recopient dans le seul dialecte qui ne la comprend pas, celui de
 * Postgres. Les minuscules étant imposées, l'unicité se compare octet à
 * octet : ni `citext`, ni index fonctionnel.
 *
 * Ce module existe pour une raison mécanique : les schémas Zod de
 * `social.ts` valident des pseudos, et `index.ts` réexporte `social.ts`.
 * Laisser la constante dans `index.ts` aurait fermé un cycle d'imports —
 * bénin ici, mais un cycle est une dette qu'on paie au moment où on ne
 * l'attend pas.
 */
export const PSEUDO_PATTERN = /^[a-z0-9_]{3,20}$/

export function isValidPseudo(value: string): boolean {
  return PSEUDO_PATTERN.test(value)
}
