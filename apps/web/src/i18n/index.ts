import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from '@/i18n/en.json'
import fr from '@/i18n/fr.json'

/**
 * Internationalisation.
 *
 * Deux langues au lancement, français et anglais. Aucune chaîne affichée
 * n'est écrite en dur dans un composant : le code étant en anglais et
 * l'interface en français, mélanger les deux dans un fichier `.tsx` est
 * exactement ce qui a rendu le domaine confus avant son renommage.
 *
 * Les catalogues sont importés statiquement plutôt que chargés à la
 * demande. Deux langues font quelques kilo-octets, et un chargement
 * asynchrone ferait apparaître un écran sans texte au démarrage — sur une
 * PWA dont l'argument est de s'ouvrir instantanément hors-ligne, c'est le
 * mauvais compromis.
 *
 * La langue détectée est persistée en `localStorage` et non dans `settings`
 * (Dexie) : elle doit être connue **avant** le premier rendu, alors qu'une
 * lecture IndexedDB est asynchrone et ferait clignoter l'interface.
 */
export const LANGUAGES = ['fr', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const LANGUAGE_STORAGE_KEY = 'owlog.language'

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    fallbackLng: 'fr',
    supportedLngs: LANGUAGES,
    // Sans ça, « fr-FR » ne trouverait pas le catalogue « fr ».
    load: 'languageOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      // React échappe déjà tout ce qu'il rend.
      escapeValue: false,
    },
  })

export default i18next
