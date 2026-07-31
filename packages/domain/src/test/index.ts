/**
 * Utilitaires de test du domaine, exposés sous `@owlog/domain/test`.
 *
 * Sous-chemin séparé de l'entrée principale : ces aides (horloge figée,
 * générateur d'identifiants séquentiels, fabrique d'événements) n'ont rien
 * à faire dans le code de production, mais tout consommateur du domaine —
 * web comme API — en a besoin pour écrire des tests déterministes.
 */
export * from './doubles.ts'
export * from './factory.ts'
