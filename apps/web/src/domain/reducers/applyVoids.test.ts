import { describe, expect, it } from 'vitest'

import { applyVoids } from '@/domain/reducers/applyVoids'
import { creerFabrique } from '@/domain/test/fabrique'

/**
 * Annulation.
 *
 * `applyVoids` s'exécute **en tête de chaîne** : tous les autres réducteurs
 * consomment sa sortie. Le store reste strictement append-only — on ajoute
 * une annulation, on n'efface jamais.
 *
 * Sans ce mécanisme, le geste le plus fréquent de l'interface serait
 * destructeur : un tap de trop sur la pastille d'un titre `✓ vu ×3` écrit
 * un `DROP` sur le cycle qui porte déjà son `SEEN`, le compteur tombe à
 * `×2`, et rien ne le restaure.
 */
describe('applyVoids', () => {
  it('retire l événement cible', () => {
    const f = creerFabrique()
    const drop = f.drop('c1')
    const evenements = [f.start('c1', '2019-01-01T20:00:00.000Z'), drop, f.annule(drop.id)]

    const resultat = applyVoids(evenements)

    expect(resultat.map((e) => e.type)).toEqual(['START'])
  })

  it('retire aussi le VOID lui-même de la projection', () => {
    const f = creerFabrique()
    const watch = f.watch()
    const resultat = applyVoids([watch, f.annule(watch.id)])

    // Le VOID a fait son travail ; le laisser passer le ferait apparaître
    // comme une entrée dans le journal, ce qui n'a pas de sens.
    expect(resultat).toHaveLength(0)
  })

  it('laisse passer les événements non cibles', () => {
    const f = creerFabrique()
    const drop = f.drop('c1')
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      drop,
      f.annule(drop.id),
    ]

    const resultat = applyVoids(evenements)

    expect(resultat.map((e) => e.type)).toEqual(['START', 'SEEN'])
  })

  it('est sans effet quand la cible n existe pas', () => {
    const f = creerFabrique()
    const resultat = applyVoids([f.watch(), f.annule('identifiant-inconnu')])

    expect(resultat.map((e) => e.type)).toEqual(['WATCH'])
  })

  it('ignore un VOID qui vise un autre VOID', () => {
    const f = creerFabrique()
    const watch = f.watch()
    const premierVoid = f.annule(watch.id)
    // Annuler une annulation serait un undo chaîné : le modèle ne le
    // prévoit pas, et le laisser passer ferait réapparaître un événement
    // que l'utilisateur croyait supprimé.
    const secondVoid = f.annule(premierVoid.id)

    const resultat = applyVoids([watch, premierVoid, secondVoid])

    expect(resultat).toHaveLength(0)
  })

  it('laisse passer les types inconnus', () => {
    const f = creerFabrique()
    const resultat = applyVoids([f.inconnu('LEND'), f.watch()])

    // Un type inconnu ne se comprend pas, donc ne se filtre pas non plus.
    // Il traverse et sera ignoré plus loin, par les réducteurs.
    expect(resultat).toHaveLength(2)
  })

  it('annule un événement d un type inconnu si on le cible', () => {
    const f = creerFabrique()
    const inconnu = f.inconnu('LEND')
    const resultat = applyVoids([inconnu, f.annule(inconnu.id)])

    // L'annulation vise un identifiant, pas un type : elle fonctionne même
    // sur un événement écrit par une version ultérieure du client.
    expect(resultat).toHaveLength(0)
  })

  it('préserve l ordre des événements restants', () => {
    const f = creerFabrique()
    const aAnnuler = f.fav()
    const resultat = applyVoids([
      f.watch(),
      aAnnuler,
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.annule(aAnnuler.id),
    ])

    expect(resultat.map((e) => e.type)).toEqual(['WATCH', 'START'])
  })
})
