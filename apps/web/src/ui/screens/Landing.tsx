import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'wouter'

import { Logo } from '@/ui/components/Logo'

/**
 * Landing — écran 1 du handoff, recréation pixel.
 *
 * Montrée aux visiteurs qui n'ont NI données locales NI session : c'est le
 * seul public à qui il reste quelque chose à vendre. L'utilisateur
 * local-first existant ne la voit jamais s'interposer — le routage de
 * `App` s'en assure.
 *
 * « COMMENCER » mène à l'onboarding LOCAL (`/welcome`), jamais à la
 * Connexion : c'est la thèse produit — l'app entière fonctionne sans
 * compte, et un mur de connexion à la première ouverture affirmerait le
 * contraire. « se connecter » est là pour l'utilisateur qui revient sur un
 * nouvel appareil.
 *
 * La capture d'app de la colonne desktop est un placeholder hachuré — la
 * vraie capture est différée (TODOS), et le motif est celui des affiches
 * absentes : une absence assumée, pas une image cassée.
 */
export function Landing() {
  const { t } = useTranslation()

  return (
    <div className="relative flex min-h-dvh flex-col">
      <nav className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-6 py-3">
        <Logo className="h-24" />
        <Link
          href="/login"
          className="rounded-[10px] border border-border-active px-[18px] py-2.5 font-mono text-[11px] text-text transition-colors hover:border-accent hover:text-accent"
        >
          {t('landing.signIn')}
        </Link>
      </nav>

      <div className="mx-auto flex w-full max-w-[1100px] flex-1 items-center px-6 py-6 lg:gap-14">
        <section className="flex max-w-[640px] flex-1 flex-col justify-center">
          <p className="font-mono text-[11px] tracking-[1px] text-accent">
            {t('landing.eyebrow')}
          </p>
          <h1 className="mt-4 font-display text-[34px] font-bold leading-[1.1] text-text lg:text-[44px]">
            <Trans
              i18nKey="landing.title"
              components={[<br key="br" />, <span key="log" className="text-gradient-action" />]}
            />
          </h1>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted">
            {t('landing.subtitle')}
          </p>

          <Link
            href="/welcome"
            className="mt-[26px] flex h-[50px] max-w-[340px] items-center justify-center rounded-action bg-gradient-action shadow-glow"
          >
            <span className="font-display text-sm font-semibold tracking-[.5px] text-bg">
              {t('landing.cta')}
            </span>
          </Link>
          <p className="mt-2.5 font-mono text-[10px] text-subtle">{t('landing.reassurance')}</p>

          <div className="mt-12 flex flex-wrap gap-9">
            <Feature
              glyph="+"
              glyphClass="text-[15px] text-accent"
              title={t('landing.feature1Title')}
              body={t('landing.feature1Body')}
            />
            <Feature
              glyph="↻"
              glyphClass="text-sm text-status-seen"
              title={t('landing.feature2Title')}
              body={t('landing.feature2Body')}
            />
            <Feature
              glyph="%"
              glyphClass="text-[13px] text-status-watch"
              title={t('landing.feature3Title')}
              body={t('landing.feature3Body')}
            />
          </div>
        </section>

        {/* Colonne desktop : la capture, hachurée en attendant la vraie.
            Palier `lg` (1024px) et non `md` (768px) : le handoff ne définit
            qu'une bascule, et 640-1023px reste la colonne mobile centrée —
            décision assumée (design F9). Un palier tablette créerait un
            troisième layout que personne n'a dessiné.
            `mx-auto` : la colonne fait la moitié du conteneur mais la capture
            est plafonnée à 300px — sans centrage, tout le reliquat s'accumule
            à droite et déséquilibre le hero sur écran large. */}
        <div className="hidden flex-1 lg:block">
          <div
            aria-hidden
            className="mx-auto aspect-[9/16] max-h-[540px] w-full max-w-[300px] rounded-card border border-border bg-poster-placeholder"
          />
        </div>
      </div>

      <footer className="mx-auto flex w-full max-w-[1100px] justify-between px-6 py-[18px]">
        <span className="font-mono text-[9.5px] text-subtle">{t('landing.footerLeft')}</span>
        <span className="font-mono text-[9.5px] text-subtle">{t('landing.footerRight')}</span>
      </footer>
    </div>
  )
}

function Feature({
  glyph,
  glyphClass,
  title,
  body,
}: {
  glyph: string
  glyphClass: string
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span aria-hidden className={glyphClass}>
          {glyph}
        </span>
        <span className="text-[13.5px] font-semibold text-text">{title}</span>
      </div>
      <span className="text-xs leading-normal text-muted">{body}</span>
    </div>
  )
}
