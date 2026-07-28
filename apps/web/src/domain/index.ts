/**
 * Domaine Owlog.
 *
 * Le visionnage est l'unité d'enregistrement, pas le film. Un store
 * d'événements append-only est la source de vérité ; tout le reste est une
 * projection calculée.
 *
 * ```
 *    geste UI ──▶ domain/commands/ ──▶ Event[] ──▶ append()  [EventStore]
 *                 (addToLibrary, advanceStatus,     append-only, transaction
 *                  advanceProgress, backdate,
 *                  rewatch, undo)
 *                                         │
 *                                ┌────────▼────────┐
 *                                │  events (Dexie) │  ◀── SOURCE DE VÉRITÉ
 *                                └────────┬────────┘
 *                                         │
 *                               applyVoids()  ◀── EN TÊTE DE CHAÎNE
 *                                         │
 *        ┌────────────────────────────────┼──────────────────────────────┐
 *  ┌─────▼─────────┐          ┌───────────▼─────────┐        ┌───────────▼────────┐
 *  │ eventsForMedia│          │  mediaState(events) │        │ eventsSince(cursor)│
 *  │               │          │                     │        │ eventsRecent(avant)│
 *  └─────┬─────────┘          └───────────┬─────────┘        └───────────┬────────┘
 *        │                                │                             │
 *  ┌─────▼─────────┐          ┌───────────▼─────────┐        ┌───────────▼────────┐
 *  │ journal()     │          │   media_state       │        │ log()  · export    │
 *  │ (page média)  │          │   (DÉRIVÉE)         │        │ LOG global · /debug│
 *  └─────┬─────────┘          └───────────┬─────────┘        └────────────────────┘
 *        │                                │
 *        │                    ┌───────────▼──────────┐
 *        │                    │ library(states)      │
 *        │                    │ homeCounters()       │
 *        │                    └───────────┬──────────┘
 *        │                                │
 *        │                    ┌───────────▼──────────┐
 *        │                    │ stats(states, cache)  │  ◀── + eventsForMedia
 *        │                    └───────────┬──────────┘      (agrégations)
 *        │                                │
 *  ┌─────▼────────────────────────────────▼──────────┐
 *  │  Page média · Bibliothèque · Accueil · Stats     │
 *  └──────────────────────────────────────────────────┘
 *
 *    media_cache ────▶ titres, affiches, genres, durées (étape 3)
 *      (entrée latérale : jamais du domaine, jamais une source de statut)
 * ```
 *
 * **Mettre ce diagramme à jour fait partie de toute modification du
 * pipeline.** Un diagramme périmé induit activement en erreur — il est pire
 * que pas de diagramme.
 *
 * Cinq règles qui ne se devinent pas en lisant les signatures :
 *
 * - `applyVoids` s'exécute **en tête de chaîne**. Tous les autres réducteurs
 *   consomment sa sortie.
 * - La **date de rang** d'un cycle est l'`occurred_at` de son événement
 *   d'ouverture. Une seule définition, trois consommateurs : la numérotation
 *   `#N`, la dérivation du statut, le tri du journal.
 * - Le statut se dérive du cycle de **rang** le plus élevé, jamais du
 *   `created_at` le plus récent. Voir `rules/status.ts` pour le piège.
 * - `journal()` groupe par cycle, `log()` ne groupe rien. Deux projections,
 *   deux responsabilités ; ce qu'elles partagent — l'exclusion des `PROG`,
 *   l'ordre à dates inconnues en queue — vit dans `rules/history.ts`.
 * - `stats()` **compte ses exclusions au lieu de les taire**. Une durée
 *   totale qui laisse tomber en silence les séries sans `total_runtime` est
 *   un chiffre faux qui a l'air juste, et TMDB en rend beaucoup.
 */

export * from '@/domain/commands'
export * from '@/domain/reducers/applyVoids'
export * from '@/domain/reducers/mediaState'
export * from '@/domain/reducers/journal'
export * from '@/domain/reducers/log'
export * from '@/domain/reducers/metrics'
export * from '@/domain/reducers/stats'
export * from '@/domain/reducers/projections'
export * from '@/domain/rules/cycles'
export * from '@/domain/rules/history'
export * from '@/domain/rules/progression'
export * from '@/domain/rules/status'
export * from '@/domain/types'
