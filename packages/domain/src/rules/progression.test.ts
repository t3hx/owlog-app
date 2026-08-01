import { describe, expect, it } from 'vitest'

import {
  advancePercent,
  applyTaps,
  episodeIncrement,
  episodesFromPercent,
  hasEpisodes,
  nextEpisodeLabel,
  upcomingEpisodeLabel,
  upcomingEpisodeNumber,
} from './progression.ts'

/**
 * Règles du bouton play.
 *
 * Elles vivent dans le domaine et non dans l'écran, parce qu'elles décident
 * du contenu d'un événement écrit pour toujours. Un incrément calculé dans
 * un composant React serait la seule règle du modèle sans test.
 */
describe('incrément par tap', () => {
  it('divise cent par le nombre d episodes', () => {
    expect(episodeIncrement(10)).toBe(10)
    expect(episodeIncrement(4)).toBe(25)
  })

  it('garde la valeur exacte, meme non entiere', () => {
    // Arrondir a 13 ferait huit taps a 104 %, et surtout ferait atteindre
    // 100 avant le dernier episode. La valeur exacte garantit qu'un tap par
    // episode clot le cycle au bon moment, ni avant ni apres.
    expect(episodeIncrement(8)).toBe(12.5)
    expect(episodeIncrement(8) * 8).toBe(100)
  })

  it('clot en un tap une serie d un seul episode', () => {
    expect(episodeIncrement(1)).toBe(100)
  })

  it('retombe sur dix quand le nombre d episodes est inconnu', () => {
    // C'est le cas des films, et celui des series dont TMDB ne renvoie pas
    // le compte. Dix points font dix taps, ce qui reste un geste credible.
    expect(episodeIncrement(null)).toBe(10)
  })

  it('retombe sur dix pour un compte absurde', () => {
    // TMDB renvoie parfois 0 sur une serie annoncee mais non diffusee.
    // Diviser par zero donnerait l'infini, donc un premier tap a 100 %.
    expect(episodeIncrement(0)).toBe(10)
    expect(episodeIncrement(-3)).toBe(10)
  })
})

describe('auto-incrément du label', () => {
  it('avance d un episode', () => {
    expect(nextEpisodeLabel('S02E05')).toBe('S02E06')
  })

  it('passe la dizaine sans perdre le zero de tete de la saison', () => {
    expect(nextEpisodeLabel('S02E09')).toBe('S02E10')
  })

  it('garde la largeur d origine du numero d episode', () => {
    // `S1E9` vient d'une saisie a la main : la respecter evite qu'un label
    // change de forme sous les doigts de celui qui l'a tape.
    expect(nextEpisodeLabel('S1E9')).toBe('S1E10')
    expect(nextEpisodeLabel('S01E01')).toBe('S01E02')
  })

  it('accepte la minuscule et la rend telle quelle', () => {
    expect(nextEpisodeLabel('s02e05')).toBe('s02e06')
  })

  it('ne touche pas a un label qui n est pas un numero d episode', () => {
    // « la fin », « moitie », un titre d'episode : on ne devine pas. Un
    // label invente serait pire que pas de label.
    expect(nextEpisodeLabel('la fin')).toBe('la fin')
  })

  it('n invente pas de label quand il n y en a pas', () => {
    // Sans label existant, on ne connait pas la saison. Ecrire `S01E01`
    // affirmerait quelque chose que personne n'a dit.
    expect(nextEpisodeLabel(null)).toBeNull()
  })
})

describe('média à épisodes', () => {
  it('une serie a des episodes', () => {
    expect(hasEpisodes('tmdb:tv/95396')).toBe(true)
  })

  it('un film n en a pas', () => {
    // C'est ce qui rend le play adaptatif : sur un film, un tap marque vu
    // au lieu d'avancer une progression qui n'aurait pas de sens.
    expect(hasEpisodes('tmdb:movie/693134')).toBe(false)
  })
})

describe('label du CTA « épisode suivant »', () => {
  it('designe l episode qui suit la progression courante', () => {
    expect(upcomingEpisodeLabel('S02E05')).toBe('S02E06')
  })

  it('garde la largeur d origine du numero', () => {
    expect(upcomingEpisodeLabel('S1E9')).toBe('S1E10')
  })

  it('se tait sur un label libre au lieu de le recopier', () => {
    // `nextEpisodeLabel` rend un label libre tel quel — juste pour un
    // journal, absurde pour un bouton : « ÉPISODE SUIVANT la fin » ne veut
    // rien dire. Le CTA affiche alors « ÉPISODE SUIVANT » sans précision.
    expect(upcomingEpisodeLabel('la fin')).toBeNull()
  })

  it('se tait quand aucun label n existe', () => {
    expect(upcomingEpisodeLabel(null)).toBeNull()
    expect(upcomingEpisodeLabel(undefined)).toBeNull()
  })
})

/**
 * Épisodes vus, déduits du pourcentage.
 *
 * La règle existait déjà dans `stats()` sous forme d'une multiplication en
 * ligne : la sortir ici la met au seul endroit où une règle métier a le droit
 * d'exister, et permet à l'accueil et à la fiche d'afficher la même
 * numérotation que les stats comptent.
 */
describe('épisodes vus déduits du pourcentage', () => {
  it('multiplie le pourcentage par le compte d episodes', () => {
    expect(episodesFromPercent(30, 10)).toBe(3)
    expect(episodesFromPercent(100, 8)).toBe(8)
  })

  it('rend zero a zero pour cent', () => {
    expect(episodesFromPercent(0, 10)).toBe(0)
  })

  it('arrondit au plus proche, comme les stats', () => {
    // 12,5 % de huit episodes font exactement un episode : les increments
    // exacts retombent toujours sur un entier, l'arrondi absorbe la derive
    // binaire (100 / 3 x 2 ne vaut pas exactement 66,67).
    expect(episodesFromPercent(12.5, 8)).toBe(1)
    expect(episodesFromPercent((100 / 3) * 2, 3)).toBe(2)
  })

  it('se tait quand le compte d episodes est inconnu ou absurde', () => {
    // C'est le cas des films, et celui des series dont TMDB ne renvoie pas
    // le compte — ou renvoie 0 sur une serie annoncee non diffusee.
    expect(episodesFromPercent(50, null)).toBeNull()
    expect(episodesFromPercent(50, undefined)).toBeNull()
    expect(episodesFromPercent(50, 0)).toBeNull()
    expect(episodesFromPercent(50, -3)).toBeNull()
  })

  it('borne un pourcentage hors gamme au lieu d inventer des episodes', () => {
    // Un pourcentage vient d'un evenement ecrit pour toujours : une valeur
    // hors gamme ne doit pas produire un onzieme episode d'une serie de dix.
    expect(episodesFromPercent(120, 10)).toBe(10)
    expect(episodesFromPercent(-5, 10)).toBe(0)
  })
})

/**
 * Numéro du prochain épisode, pour le CTA de la fiche.
 *
 * C'est la moitié « sans label » du CTA « ÉPISODE SUIVANT » : quand personne
 * n'a jamais saisi de `S01E04`, la saison est inconnue mais le rang de
 * l'épisode, lui, se déduit du pourcentage et du compte d'épisodes.
 */
describe('numéro du prochain épisode', () => {
  it('designe l episode qui suit ceux deja vus', () => {
    expect(upcomingEpisodeNumber(0, 10)).toBe(1)
    expect(upcomingEpisodeNumber(30, 10)).toBe(4)
  })

  it('designe le dernier episode juste avant la fin', () => {
    expect(upcomingEpisodeNumber(90, 10)).toBe(10)
  })

  it('se tait une fois le cycle clos', () => {
    // A 100 % il n'y a plus de suivant : designer un onzieme episode d'une
    // serie de dix serait un episode qui n'existe pas.
    expect(upcomingEpisodeNumber(100, 10)).toBeNull()
  })

  it('se tait quand le compte d episodes est inconnu', () => {
    expect(upcomingEpisodeNumber(30, null)).toBeNull()
    expect(upcomingEpisodeNumber(30, undefined)).toBeNull()
    expect(upcomingEpisodeNumber(30, 0)).toBeNull()
  })
})

describe('borne de la progression', () => {
  it('additionne tant qu on est sous cent', () => {
    expect(advancePercent(60, 12.5)).toBe(72.5)
  })

  it('borne a cent plutot que de deborder', () => {
    expect(advancePercent(95, 10)).toBe(100)
  })

  it('borne aussi la derive du binaire', () => {
    // 100 / 3 x 3 vaut 100.00000000000001. Sans borne, un cycle de trois
    // episodes finirait a 100.00000000000001 % : le `PROG` porterait une
    // valeur que personne ne peut relire, et l'affichage dirait « 100 % »
    // sur une donnee qui n'est pas 100.
    expect(advancePercent(0, episodeIncrement(3) * 3)).toBe(100)
  })
})

/**
 * Projection de N taps sur un avancement de depart.
 *
 * Elle existe pour une seule raison : l'affichage avance a chaque tap, mais
 * l'ecriture est regroupee. Les deux chemins doivent tomber sur exactement la
 * meme valeur, sans quoi la barre reculerait au moment de l'ecriture.
 */
describe('projection des taps', () => {
  const start = { percent: 0, label: null }

  it('ne bouge pas sans tap', () => {
    expect(applyTaps({ percent: 40, label: 'S01E04' }, 0, 10)).toEqual({
      percent: 40,
      label: 'S01E04',
    })
  })

  it('avance d autant de crans que de taps', () => {
    expect(applyTaps(start, 3, 10).percent).toBe(30)
  })

  it('avance le label une fois par tap', () => {
    expect(applyTaps({ percent: 0, label: 'S01E01' }, 2, 10).label).toBe('S01E03')
  })

  it('garde le label absent absent', () => {
    // C'est le cas des films : trois taps ne doivent pas faire apparaitre un
    // numero d episode sur un long metrage.
    expect(applyTaps(start, 3, 10).label).toBeNull()
  })

  it('borne a cent', () => {
    expect(applyTaps({ percent: 80, label: null }, 5, 10).percent).toBe(100)
  })

  it('tombe sur cent pile pour un tap par episode', () => {
    const increment = episodeIncrement(8)
    expect(applyTaps(start, 7, increment).percent).toBe(87.5)
    expect(applyTaps(start, 8, increment).percent).toBe(100)
  })

  it('n avance pas le label au dela du dernier episode', () => {
    // Dix taps sur une serie de dix episodes menent a 100 % et au dixieme
    // episode, pas au onzieme. Le label dit ou on en est, et une fois le
    // cycle clos il n'y a plus de suivant a designer — un `S01E11` serait
    // grave pour toujours dans un store qui ne se corrige pas.
    const projected = applyTaps({ percent: 0, label: 'S01E01' }, 10, episodeIncrement(10))

    expect(projected.percent).toBe(100)
    expect(projected.label).toBe('S01E10')
  })

  it('avance normalement tant que le cycle reste ouvert', () => {
    // Le garde-fou ne doit pas manger un cran en cours de route.
    expect(applyTaps({ percent: 0, label: 'S01E01' }, 9, episodeIncrement(10)).label).toBe(
      'S01E10',
    )
    expect(applyTaps({ percent: 0, label: 'S01E01' }, 3, episodeIncrement(10)).label).toBe(
      'S01E04',
    )
  })

  it('ne touche plus au label une fois le cycle deja clos', () => {
    expect(applyTaps({ percent: 100, label: 'S01E10' }, 2, 10).label).toBe('S01E10')
  })

  it('ignore un nombre de taps absurde', () => {
    // Defensif et pas theorique : le compteur de taps vient d'un etat React
    // remis a zero par un vidage concurrent, et un tap negatif ferait reculer
    // une barre de progression.
    expect(applyTaps({ percent: 40, label: 'S01E04' }, -2, 10).percent).toBe(40)
  })

  it('donne le meme resultat que l addition faite a l ecriture', () => {
    // C'est l'invariant qui compte : l'affichage optimiste calcule
    // `applyTaps`, et la commande ecrit `advancePercent` avec le meme total.
    // Les deux doivent coincider au bit pres, sinon la barre saute au flush.
    const increment = episodeIncrement(7)
    expect(applyTaps(start, 4, increment).percent).toBe(advancePercent(0, 4 * increment))
  })
})
