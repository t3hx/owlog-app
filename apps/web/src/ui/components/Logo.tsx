import { useTranslation } from 'react-i18next'

/**
 * Logo Owlog — l'image source, telle quelle.
 *
 * Décision utilisateur (2026-08-01, T3H-57, amendement au handoff) : le
 * logo est l'image `owlog_logo_full.png`, affichée SANS recadrage ni
 * recomposition — seule la taille varie selon la surface (header M,
 * Connexion L). L'unique dérivé autorisé est le recadrage hibou des
 * favicons et icônes PWA.
 *
 * Fond transparent (alpha dérivé de la luminance : le halo néon garde son
 * fondu). L'image est précachée par le service worker : le logo s'affiche
 * en mode avion, comme l'exigeait l'ancien wordmark texte, supprimé.
 *
 * `block` : une <img> inline s'aligne sur la baseline du texte, ce qui la
 * décale vers le haut dans les barres en `items-center`. En block, le
 * centrage vertical flex est exact.
 */
export function Logo({ className }: { className?: string }) {
  const { t } = useTranslation()

  return (
    <img
      src="/owlog_logo_full.png"
      alt={t('app.logoAlt')}
      className={`block w-auto select-none ${className ?? ''}`}
      draggable={false}
    />
  )
}
