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
  })
})
