import { useTranslation } from 'react-i18next'

/**
 * Attribution TMDB.
 *
 * Exigée par les conditions d'utilisation de TMDB dès lors que l'app est
 * accessible publiquement, et le déploiement de cette étape la rend
 * publique. Elle n'est donc pas cosmétique : elle conditionne le droit
 * d'utiliser l'API.
 *
 * Le handoff ne la prévoit nulle part. Elle vit en pied de l'écran de
 * bienvenue, seul écran que tout le monde traverse au moins une fois, et
 * elle rejoindra un écran « à propos » quand il existera.
 */
export function Attribution() {
  const { t } = useTranslation()

  return (
    <p className="font-mono text-[9px] leading-relaxed text-subtle">
      {t('attribution.tmdb')}
    </p>
  )
}
