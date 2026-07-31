import { describe, expect, it } from 'vitest'

import { format, SEPARATOR, type ExportTitle } from './format.ts'
import { parse } from './parse.ts'
import { createFactory, MOVIE, SERIES } from '../test/factory.ts'
import type { MediaRef, StoredEvent } from '../types.ts'

/**
 * Export et import `.log`.
 *
 * C'est le seul filet de sécurité du projet : IndexedDB peut être évincé, et
 * sur iOS désinstaller une PWA efface son stockage. Un export qu'on ne peut
 * pas réinjecter n'est pas une sauvegarde, c'est un souvenir.
 *
 * D'où le test qui compte plus que les autres : `parse(format(events))` rend
 * exactement les mêmes événements. Tout le reste de ce fichier ne fait que
 * dire pourquoi il pourrait échouer.
 *
 * L'ordre de comparaison est celui des identifiants. Les UUIDv7 sont
 * ordonnables par le temps, c'est l'ordre naturel du store — `eventsSince`
 * parcourt déjà par `id` — et le fichier range les `PROG` en fin, donc
 * comparer l'ordre du tableau d'entrée n'aurait mesuré que ce rangement.
 */
const NOW = '2026-07-28T15:00:00.000Z'

const TITLES = new Map<MediaRef, ExportTitle>([
  [MOVIE, { title: 'Matrix', year: 1999 }],
  [SERIES, { title: 'Severance', year: 2022 }],
])

function byId(events: readonly StoredEvent[]): readonly StoredEvent[] {
  return [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function roundTrip(events: readonly StoredEvent[]) {
  return parse(format(events, TITLES, NOW)).events
}

/** Un jeu qui touche chaque forme d'événement du modèle. */
function everyShape(): readonly StoredEvent[] {
  const f = createFactory(MOVIE)
  const g = createFactory(SERIES)

  return [
    f.watch(),
    f.start('c1', '2019-06-01T20:00:00.000Z'),
    f.rate('c1', 4),
    f.note('c1', 'meilleur que dans mon souvenir'),
    f.seen('c1'),
    f.rewatch('c2'),
    f.prog('c2', 40, { label: 'S02E05' }),
    f.drop('c2'),
    f.fav(),
    f.unfav(),
    f.remove(),
    g.watch(),
    g.start('c3'),
    g.prog('c3', 100),
    g.rate('c3', null),
    g.voided(g.lastId()),
    g.unknown('LEND'),
  ]
}

describe('aller-retour', () => {
  it('rend exactement les evenements de depart', () => {
    const events = everyShape()

    expect(roundTrip(events)).toEqual(byId(events))
  })

  it('rend un fichier valide et vide pour un store vide', () => {
    expect(roundTrip([])).toEqual([])
  })

  it('preserve une date de survenue absente et sa precision', () => {
    const f = createFactory()
    // Le retro-datage « je ne sais plus quand » : la date est nulle et la
    // precision le dit. Perdre l'un des deux rendrait la ligne mensongere.
    const events = [f.watch(), f.start('c1', null, 'unknown')]

    const parsed = roundTrip(events)

    expect(parsed[1]?.occurred_at).toBeNull()
    expect(parsed[1]?.occurred_precision).toBe('unknown')
  })

  it('preserve une precision plus grossiere que le jour', () => {
    const f = createFactory()
    // « en 2019 » est une date legitime. La tete de ligne n'affiche que
    // l'annee, mais la queue garde l'horodatage complet : sans lui, un
    // aller-retour deplacerait la date au 1er janvier.
    const events = [f.watch(), f.start('c1', '2019-06-01T20:00:00.000Z', 'year')]

    expect(roundTrip(events)[1]).toMatchObject({
      occurred_at: '2019-06-01T20:00:00.000Z',
      occurred_precision: 'year',
    })
  })

  it('preserve un commentaire a espaces, guillemets et retours a la ligne', () => {
    const f = createFactory()
    // Le texte libre est le seul champ ou l'utilisateur peut ecrire ce qu'il
    // veut, y compris ce qui casserait un format a colonnes.
    const text = 'il a dit « on y va | maintenant »\net il est parti'
    const events = [f.watch(), f.start('c1'), f.note('c1', text)]

    const parsed = roundTrip(events)

    expect(parsed[2]).toMatchObject({ type: 'NOTE', payload: { text } })
  })

  it('preserve un titre contenant le separateur de colonnes', () => {
    const f = createFactory()
    const titles = new Map<MediaRef, ExportTitle>([
      [MOVIE, { title: 'Trainspotting | Deuxieme partie', year: 2017 }],
    ])
    const events = [f.watch()]

    // Le titre vient de `media_cache` et n'est pas de la donnee utilisateur :
    // la tete de ligne peut l'assainir. Ce qui ne peut pas casser, c'est la
    // relecture des evenements.
    expect(parse(format(events, titles, NOW)).events).toEqual(events)
  })

  it('preserve un evenement d un type inconnu et sa charge', () => {
    const f = createFactory()
    // Le store est append-only pour toujours et l'enumeration grossira. Un
    // export qui jette ce qu'il ne comprend pas transforme une version en
    // retard en perte de donnees definitive.
    const events = [f.watch(), f.unknown('LEND')]

    expect(roundTrip(events)).toEqual(byId(events))
  })
})

describe('reglages', () => {
  it('emporte le prenom et le rend a la relecture', () => {
    const f = createFactory()
    const settings = new Map([['firstName', 'Tx']])

    const { settings: back } = parse(format([f.watch()], TITLES, NOW, settings))

    // Sans les reglages, une restauration rend les evenements mais laisse
    // l'app a l'ecran de premiere ouverture, qui affirme « ton log est vide »
    // par-dessus un log qui ne l'est pas.
    expect(back.get('firstName')).toBe('Tx')
  })

  it('supporte une valeur a espaces et a caracteres speciaux', () => {
    const f = createFactory()
    const settings = new Map([['firstName', 'Jean = « Jo » | fils']])

    const { settings: back } = parse(format([f.watch()], TITLES, NOW, settings))

    expect(back.get('firstName')).toBe('Jean = « Jo » | fils')
  })

  it('reste relisable par un client qui ignore les reglages', () => {
    const f = createFactory()
    const text = format([f.watch()], TITLES, NOW, new Map([['firstName', 'Tx']]))

    // Les reglages voyagent en commentaires : une version anterieure du
    // parseur les saute sans rien casser.
    expect(text).toContain('# setting firstName')
    expect(parse(text).events).toHaveLength(1)
  })

  it('n ecrit aucune ligne de reglage quand il n y en a pas', () => {
    const f = createFactory()

    expect(format([f.watch()], TITLES, NOW)).not.toContain('# setting')
  })
})

describe('les deux sections', () => {
  it('range les PROG hors du corps narratif', () => {
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.prog('c1', 40, { label: 'S02E05' }), f.seen('c1')]

    const [body, progress] = format(events, TITLES, NOW).split(SECTION)

    expect(body).toBeDefined()
    expect(progress).toBeDefined()
    // Personne ne veut relire qu'il a pousse la barre a 40 % un mardi soir.
    expect(body).not.toContain('PROG')
    expect(progress).toContain('PROG')
  })

  it('garde les PROG dans le fichier, parce qu une sauvegarde les restitue', () => {
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.prog('c1', 60, { label: 'S02E05' })]

    const restored = roundTrip(events)

    // Sans cette ligne, une serie a 60 % revient a 0 % apres restauration, et
    // rien a l'ecran ne signale la perte : le statut reste « en cours ».
    expect(restored).toContainEqual(
      expect.objectContaining({ type: 'PROG', payload: { percent: 60, label: 'S02E05' } }),
    )
  })

  it('n ecrit pas de section de progression quand il n y a aucun PROG', () => {
    const f = createFactory()

    expect(format([f.watch()], TITLES, NOW)).not.toContain(SECTION)
  })
})

describe('lisibilite', () => {
  it('montre les titres et non des references nues', () => {
    const f = createFactory(MOVIE)
    const text = format([f.watch()], TITLES, NOW)

    expect(text).toContain('Matrix (1999)')
  })

  it('numerote les visionnages comme le journal', () => {
    const f = createFactory()
    const events = [
      f.watch(),
      f.start('c1', '2019-06-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    const text = format(events, TITLES, NOW)

    // Le rang vient de `cycles()`, la seule definition du projet. Le
    // recalculer ici ferait une deuxieme regle qui divergerait en silence.
    expect(text).toContain('#1')
    expect(text).toContain('#2')
  })

  it('rend une reference nue quand le titre est inconnu du cache', () => {
    const f = createFactory(MOVIE)
    // La ligne de cache est perdable par conception. L'export doit sortir
    // quand meme : une reference nue reste reimportable, une exception non.
    const text = format([f.watch()], new Map(), NOW)

    expect(text).toContain(MOVIE)
  })
})

describe('relecture', () => {
  it('ignore les commentaires et les lignes vides', () => {
    const f = createFactory()
    const events = [f.watch()]
    const text = format(events, TITLES, NOW)

    const decorated = text.replace(/\n/, '\n# une note ajoutee a la main\n\n')

    expect(parse(decorated).events).toEqual(events)
  })

  it('refuse un fichier tronque plutot que de restaurer a moitie', () => {
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.seen('c1')]
    // Une copie interrompue perd la fin du fichier. Le resultat reste
    // parfaitement bien forme, ce qui est exactement le danger.
    const truncated = format(events, TITLES, NOW).trimEnd().split('\n').slice(0, -1).join('\n')

    // Un import partiel silencieux est le pire des resultats : l'utilisateur
    // croit sa sauvegarde bonne et decouvre le trou des mois plus tard.
    expect(() => parse(truncated)).toThrow(/declares 3.*found 2/)
  })

  it('refuse une ligne illisible en disant laquelle', () => {
    const f = createFactory()
    const lines = format([f.watch()], TITLES, NOW).trimEnd().split('\n')
    lines[lines.length - 1] = `abimee${SEPARATOR}pas-du-tout-un-evenement`

    expect(() => parse(lines.join('\n'))).toThrow(/line \d+/)
  })

  it('refuse un fichier ecrit par une version plus recente', () => {
    const f = createFactory()
    // Mieux vaut refuser que restaurer en ignorant ce qu'on ne comprend pas :
    // l'utilisateur garderait un fichier valide et une base amputee.
    const future = format([f.watch()], TITLES, NOW).replace('export v1', 'export v9')

    expect(() => parse(future)).toThrow(/version 9/)
  })

  it('relit les titres pour reamorcer le cache hors ligne', () => {
    const f = createFactory(MOVIE)
    // Une restauration se fait souvent sans reseau. Sans les titres du
    // fichier, la bibliotheque revient en references nues jusqu'au prochain
    // appel a TMDB.
    const { titles } = parse(format([f.watch()], TITLES, NOW))

    expect(titles.get(MOVIE)).toEqual({ title: 'Matrix', year: 1999 })
  })
})

/** En-tete de la section de progression, tel que le formateur l'ecrit. */
const SECTION = '# --- progression'
