/**
 * Domaine Owlog.
 *
 * Le visionnage est l'unité d'enregistrement, pas le film. Un store
 * d'événements append-only est la source de vérité ; tout le reste est une
 * projection calculée.
 *
 * ```
 *    geste UI ──▶ domain/commands/ ──▶ Event[] ──▶ append()  [EventStore]
 *                 (ajouter, avancerStatut,          append-only, transaction
 *                  progresser, retroDater,
 *                  revoir, annuler)
 *                                         │
 *                                ┌────────▼────────┐
 *                                │  events (Dexie) │  ◀── SOURCE DE VÉRITÉ
 *                                └────────┬────────┘
 *                                         │
 *                               applyVoids()  ◀── EN TÊTE DE CHAÎNE
 *                                         │
 *        ┌────────────────────────────────┼──────────────────────────────┐
 *  ┌─────▼─────────┐          ┌───────────▼─────────┐        ┌───────────▼────────┐
 *  │ eventsForMedia│          │  etatMedia(events)  │        │ eventsSince(cursor)│
 *  └─────┬─────────┘          └───────────┬─────────┘        └───────────┬────────┘
 *        │                                │                             │
 *  ┌─────▼─────────┐          ┌───────────▼─────────┐        ┌───────────▼────────┐
 *  │ journal()     │          │   media_state       │        │ export .log        │
 *  │ (page média)  │          │   (DÉRIVÉE)         │        │ LOG global · /debug│
 *  └─────┬─────────┘          └───────────┬─────────┘        └────────────────────┘
 *        │                                │
 *        │                    ┌───────────▼──────────┐
 *        │                    │ bibliotheque(etats)  │
 *        │                    │ compteursAccueil()   │
 *        │                    └───────────┬──────────┘
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
 * Trois règles qui ne se devinent pas en lisant les signatures :
 *
 * - `applyVoids` s'exécute **en tête de chaîne**. Tous les autres réducteurs
 *   consomment sa sortie.
 * - La **date de rang** d'un cycle est l'`occurred_at` de son événement
 *   d'ouverture. Une seule définition, trois consommateurs : la numérotation
 *   `#N`, la dérivation du statut, le tri du journal.
 * - Le statut se dérive du cycle de **rang** le plus élevé, jamais du
 *   `created_at` le plus récent. Voir `rules/status.ts` pour le piège.
 */

export * from '@/domain/commands'
export * from '@/domain/reducers/applyVoids'
export * from '@/domain/reducers/mediaState'
export * from '@/domain/reducers/journal'
export * from '@/domain/reducers/metrics'
export * from '@/domain/reducers/projections'
export * from '@/domain/rules/cycles'
export * from '@/domain/rules/status'
export * from '@/domain/types'
