import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.ts'

/**
 * Lecture de la configuration.
 *
 * Elle échoue bruyamment plutôt que de laisser le service tourner à moitié.
 * Ces tests fixent surtout la normalisation du préfixe : c'est une valeur
 * saisie à la main dans une interface web, donc écrite tantôt `api`, tantôt
 * `/api/`, et une comparaison de chemins ne pardonne pas l'écart.
 */
const MINIMAL = {
  TMDB_API_TOKEN: 'tmdb-test-token',
  OWLOG_SHARED_TOKEN: 'shared-test-token',
}

describe('loadConfig', () => {
  it('refuse de démarrer sans jeton TMDB', () => {
    expect(() => loadConfig({ OWLOG_SHARED_TOKEN: 'x' })).toThrow(/TMDB_API_TOKEN/)
  })

  it('refuse de démarrer sans jeton partagé', () => {
    expect(() => loadConfig({ TMDB_API_TOKEN: 'x' })).toThrow(/OWLOG_SHARED_TOKEN/)
  })

  describe('préfixe de montage', () => {
    it('est vide par défaut', () => {
      // Le développement local sert l'API à la racine de son port.
      expect(loadConfig(MINIMAL).basePath).toBe('')
    })

    it('accepte un préfixe déjà bien écrit', () => {
      expect(loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '/api' }).basePath).toBe('/api')
    })

    it('ajoute la barre oblique manquante', () => {
      expect(loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: 'api' }).basePath).toBe('/api')
    })

    it('retire la barre oblique finale', () => {
      expect(loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '/api/' }).basePath).toBe('/api')
    })

    it('traite une barre oblique seule comme une absence de préfixe', () => {
      // `/` saisi dans un champ « chemin » veut dire la racine, pas un
      // préfixe vide suivi d'un séparateur — monter sur `/` doublerait la
      // barre et aucune route ne correspondrait plus.
      expect(loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '/' }).basePath).toBe('')
    })

    it('ignore les espaces autour', () => {
      expect(loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '  /api  ' }).basePath).toBe('/api')
    })

    describe('valeur inexploitable', () => {
      // Le service refuse de demarrer plutot que de se monter sous un chemin
      // que personne n'appellera jamais. Monte sous `/"/api"`, il repond 404
      // sur tout, et le 404 ressemble a un probleme de routage — on cherche
      // alors du cote du proxy pendant que la cause est dans un champ de
      // formulaire.
      it('refuse un prefixe entoure de guillemets', () => {
        // `doppler secrets download --format env` rend OWLOG_BASE_PATH="/api".
        // Colle tel quel dans un champ qui ne desencadre pas, la valeur
        // arrive avec ses guillemets.
        expect(() => loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '"/api"' })).toThrow(
          /OWLOG_BASE_PATH/,
        )
      })

      it('nomme les guillemets dans le message', () => {
        expect(() => loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: "'/api'" })).toThrow(
          /quote/i,
        )
      })

      it('refuse un prefixe contenant une espace', () => {
        expect(() => loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '/mon api' })).toThrow(
          /OWLOG_BASE_PATH/,
        )
      })

      it('accepte les caracteres legitimes d un chemin', () => {
        expect(loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '/api/v1' }).basePath).toBe(
          '/api/v1',
        )
        expect(loadConfig({ ...MINIMAL, OWLOG_BASE_PATH: '/owlog-api' }).basePath).toBe(
          '/owlog-api',
        )
      })
    })
  })
})
