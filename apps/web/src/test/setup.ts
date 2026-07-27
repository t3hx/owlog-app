/**
 * Mise en place commune aux tests.
 *
 * `fake-indexeddb` fournit une implémentation d'IndexedDB en mémoire : les
 * tests d'adaptateur s'exécutent contre le vrai Dexie, pas contre un double,
 * ce qui est le seul moyen de vérifier qu'un `append` est bien transactionnel.
 */
import 'fake-indexeddb/auto'
