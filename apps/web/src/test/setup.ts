/**
 * Mise en place commune aux tests.
 *
 * `fake-indexeddb` fournit une implémentation d'IndexedDB en mémoire : les
 * tests d'adaptateur s'exécutent contre le vrai Dexie, pas contre un double,
 * ce qui est le seul moyen de vérifier qu'un `append` est bien transactionnel.
 *
 * Le démontage après chaque test est explicite parce que `globals` est
 * désactivé : sans lui, Testing Library n'installe pas son nettoyage
 * automatique, les arbres rendus s'empilent dans le même `document`, et une
 * requête par texte trouve deux nœuds là où le test en attend un.
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import 'fake-indexeddb/auto'

afterEach(cleanup)
