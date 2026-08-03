import { isValidPseudo } from '@owlog/contracts'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'

import { LANGUAGES } from '@/i18n'
import type { SyncStatus } from '@/ports/Sync'
import { useBackup } from '@/ui/hooks/useBackup'
import { useSetting } from '@/ui/hooks/useSetting'
import { usePorts } from '@/ui/PortsProvider'
import { useSession } from '@/ui/session/SessionProvider'

/**
 * Réglages — `/settings`, spec `design_handoff_owlog/reglages.md`.
 *
 * Quatre sections dans un ordre imposé : `▸ COMPTE` (la card de statut
 * sync est l'ancre visuelle de l'écran) → `▸ PROFIL` → `▸ DONNÉES` →
 * `▸ ZONE DANGEREUSE`, dernière et isolée — jamais adjacente à l'export,
 * pour qu'un pouce pressé ne confonde pas « sauvegarder » et « détruire ».
 *
 * Le compte reste optionnel, et ça se voit : sans session, la section
 * COMPTE est une invitation (« ACTIVER LA SYNC »), pas un péage — langue,
 * prénom et export fonctionnent au-dessus.
 *
 * Pas de modal, nulle part : la confirmation destructive est un écran
 * plein dans les codes de `Welcome` (voir `PurgeConfirm`).
 */
export function Settings() {
  const { t } = useTranslation()
  const [confirmingPurge, setConfirmingPurge] = useState(false)

  if (confirmingPurge) {
    return <PurgeConfirm onCancel={() => setConfirmingPurge(false)} />
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-7 px-5 py-6">
      <h1 className="font-display text-[25px] font-semibold text-text">
        {t('settings.title')}
      </h1>

      <AccountSection />
      <ProfileSection />
      <DataSection />

      {/* Marge haute doublée : la zone dangereuse est isolée à dessein. */}
      <section className="mt-7 flex flex-col gap-3">
        <SectionTitle>{t('settings.dangerTitle')}</SectionTitle>
        <Card>
          <Row label={t('settings.purge')} onActivate={() => setConfirmingPurge(true)} />
        </Card>
      </section>
    </div>
  )
}

/** `▸ SECTION` — Chakra Petch majuscules, préfixe du système. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[13px] font-semibold uppercase tracking-[.5px] text-muted">
      <span aria-hidden className="text-accent">
        ▸{' '}
      </span>
      {children}
    </h2>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-card border border-border bg-surface-translucent">
      {children}
    </div>
  )
}

/**
 * Rangée de réglage — composant de la spec : label en corps, valeur en
 * mono muted, ≥ 44px. Aucun chevron : la valeur EST l'indice
 * d'interactivité.
 */
function Row({
  label,
  value,
  onActivate,
  children,
}: {
  label: string
  value?: string
  onActivate?: () => void
  children?: ReactNode
}) {
  const inner = (
    <>
      <span className="text-[13.5px] text-text">{label}</span>
      {value !== undefined && (
        <span className="font-mono text-[10.5px] text-muted">{value}</span>
      )}
      {children}
    </>
  )

  if (onActivate === undefined) {
    return <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2">{inner}</div>
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      className="flex min-h-11 w-full items-center justify-between gap-4 px-4 py-2 text-left"
    >
      {inner}
    </button>
  )
}

// --- ▸ COMPTE ---------------------------------------------------------------

function AccountSection() {
  const { t } = useTranslation()
  const session = useSession()

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t('settings.accountTitle')}</SectionTitle>

      {session.loading ? (
        <Card>
          <Row label="…" />
        </Card>
      ) : session.user === null ? (
        <ActivateSyncCard />
      ) : (
        <ConnectedCard email={session.user.email} onLogout={() => void session.clear()} />
      )}

      <p className="font-mono text-[10px] leading-relaxed text-subtle">
        {t('settings.privacyWhere')}
        <br />
        {t('settings.privacyLogout')}
        <br />
        {t('settings.privacyPurge')}
      </p>
    </section>
  )
}

function ActivateSyncCard() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-translucent p-4">
      <p className="text-[13.5px] leading-relaxed text-muted">{t('settings.activateBody')}</p>
      <Link
        href="/login"
        className="flex h-11 items-center justify-center rounded-action bg-gradient-action font-display text-[13px] font-semibold tracking-[.5px] text-bg shadow-glow"
      >
        {t('settings.activateCta')}
      </Link>
    </div>
  )
}

/**
 * La card d'ancrage : l'état de la synchronisation, en un coup d'œil.
 * `✓ à jour` menthe · `N à pousser` jaune · `hors-ligne` muted · l'erreur
 * en sémantique système. La date en mono 10px, l'e-mail en mono muted.
 */
function ConnectedCard({ email, onLogout }: { email: string; onLogout: () => void }) {
  const { t } = useTranslation()
  const { sync, live } = usePorts()
  const [status, setStatus] = useState<SyncStatus>(() => sync.status())
  useEffect(() => sync.subscribe(() => setStatus(sync.status())), [sync])
  const pending = live.usePendingPushCount()

  const state = (() => {
    if (status.lastError === 'offline') {
      return { text: t('settings.syncOffline'), tone: 'text-muted' }
    }
    if (status.lastError !== null) {
      return { text: `! ${t('settings.syncError')}`, tone: 'text-muted' }
    }
    if (pending > 0) {
      return { text: t('settings.syncPending', { count: pending }), tone: 'text-status-watch' }
    }
    return { text: t('settings.syncUpToDate'), tone: 'text-accent' }
  })()

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-translucent p-4">
      <span className={`font-mono text-[12px] ${state.tone}`}>{state.text}</span>
      {status.lastSyncAt !== null && (
        <span className="font-mono text-[10px] text-subtle">
          {t('settings.lastSync', {
            date: new Date(status.lastSyncAt).toLocaleString(),
          })}
        </span>
      )}
      <span className="font-mono text-[10.5px] text-muted">{email}</span>
      <button
        type="button"
        onClick={onLogout}
        className="mt-2 h-11 rounded-action border border-border-active font-display text-[13px] font-semibold tracking-[.5px] text-text transition-colors hover:border-accent"
      >
        {t('settings.logout')}
      </button>
    </div>
  )
}

// --- ▸ PROFIL ---------------------------------------------------------------

function ProfileSection() {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t('settings.profileTitle')}</SectionTitle>
      <Card>
        <FirstNameRow />
        <PseudoRow />
        <LanguageRow />
      </Card>
    </section>
  )
}

function FirstNameRow() {
  const { t } = useTranslation()
  const { settings, auth } = usePorts()
  const session = useSession()
  const { value: firstName } = useSetting('firstName')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const cleaned = draft.trim()
    if (cleaned.length === 0) return

    await settings.write('firstName', cleaned)
    // Le serveur fait autorité après connexion : l'édition pousse l'upsert,
    // l'écran ne garde aucune copie divergente. Hors session ou hors
    // réseau, la valeur locale vit sa vie — la prochaine session tranchera.
    if (session.user !== null) void auth.updateProfile({ firstName: cleaned })
    setEditing(false)
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="flex min-h-11 items-center gap-2.5 px-4 py-2">
        <span aria-hidden className="font-mono text-[13px] text-accent">
          ›
        </span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={40}
          autoFocus
          enterKeyHint="done"
          aria-label={t('settings.firstName')}
          className="h-9 w-full rounded-action border border-border-accent bg-surface px-2 text-[13.5px] text-text outline-none"
        />
        <button type="submit" className="min-h-0 font-mono text-[10.5px] text-accent">
          {t('settings.save')}
        </button>
      </form>
    )
  }

  return (
    <Row
      label={t('settings.firstName')}
      value={firstName ?? '—'}
      onActivate={() => {
        setDraft(firstName ?? '')
        setEditing(true)
      }}
    />
  )
}

/**
 * Le pseudo — identité sociale, et la seule donnée de cette card qui
 * quitte le compte.
 *
 * Trois traits qui le distinguent de la rangée prénom, tous délibérés :
 *
 * - **il n'existe qu'en ligne.** Aucune écriture dans `settings` : un
 *   pseudo n'a de sens que si le serveur l'a accordé, et une copie locale
 *   « en attente » afficherait une identité que personne d'autre ne voit ;
 * - **le serveur fait autorité sur ce qui s'affiche.** La rangée rend
 *   `session.user.pseudo`, jamais la saisie — même après un succès ;
 * - **l'erreur vit sous le champ**, en sémantique d'erreur système, et non
 *   en bandeau : c'est le champ qui est en cause.
 *
 * Hors session, la rangée n'est pas rendue : réserver un pseudo suppose un
 * compte, et une rangée morte serait pire qu'une rangée absente.
 */
function PseudoRow() {
  const { t } = useTranslation()
  const { auth } = usePorts()
  const session = useSession()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<'taken' | 'invalid' | 'offline' | null>(null)
  const [saving, setSaving] = useState(false)

  const pseudo = session.user?.pseudo ?? null
  if (session.user === null) return null

  async function submit(event: FormEvent) {
    event.preventDefault()
    const cleaned = draft.trim().toLowerCase()
    if (!isValidPseudo(cleaned)) {
      setError('invalid')
      return
    }

    setSaving(true)
    const result = await auth.updateProfile({ pseudo: cleaned })
    setSaving(false)

    if (!result.ok) {
      setError(result.failure.kind === 'pseudo-taken' ? 'taken' : 'offline')
      return
    }

    // Le reflet suit la réponse du serveur, pas la saisie : c'est lui qui a
    // tranché la casse et l'unicité.
    session.adopt(result.value)
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-1 px-4 py-2">
        <div className="flex min-h-11 items-center gap-2.5">
          <span aria-hidden className="font-mono text-[13px] text-accent">
            @
          </span>
          <input
            value={draft}
            // Les minuscules sont forcées à la frappe, pas corrigées à
            // l'envoi : voir son texte changer après coup se lit comme un
            // bug, alors que la contrainte est connue d'avance.
            onChange={(event) => {
              setDraft(event.target.value.toLowerCase())
              setError(null)
            }}
            maxLength={20}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            aria-label={t('settings.pseudo')}
            className="h-9 w-full rounded-action border border-border-accent bg-surface px-2 text-[13.5px] text-text outline-none"
          />
          <button
            type="submit"
            disabled={saving}
            className="min-h-0 font-mono text-[10.5px] text-accent disabled:text-muted"
          >
            {t('settings.save')}
          </button>
        </div>
        <p className="font-mono text-[10px] text-subtle">
          {error === null ? (
            t('settings.pseudoHint')
          ) : (
            <span className="text-muted">
              <span aria-hidden>! </span>
              {t(
                error === 'taken'
                  ? 'settings.pseudoTaken'
                  : error === 'invalid'
                    ? 'settings.pseudoInvalid'
                    : 'settings.pseudoOffline',
              )}
            </span>
          )}
        </p>
      </form>
    )
  }

  return (
    <Row
      label={t('settings.pseudo')}
      value={pseudo === null ? '—' : `@${pseudo}`}
      onActivate={() => {
        setDraft(pseudo ?? '')
        setError(null)
        setEditing(true)
      }}
    />
  )
}

/**
 * Chips de langue — le pattern des chips de la bibliothèque, réduit à
 * deux, codes de la chip « tous » : une langue n'a pas de couleur
 * sémantique. Le stockage ne bouge pas : `localStorage`, via i18next —
 * la langue doit être connue avant le premier rendu.
 */
function LanguageRow() {
  const { t, i18n } = useTranslation()
  const current = i18n.resolvedLanguage

  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2">
      <span className="text-[13.5px] text-text">{t('settings.language')}</span>
      <div role="group" aria-label={t('settings.language')} className="flex gap-1.5">
        {LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            onClick={() => void i18n.changeLanguage(language)}
            aria-pressed={current === language}
            className={
              current === language
                ? 'min-h-0 rounded-full border border-border-active bg-surface px-3 py-1.5 font-mono text-[10.5px] text-text'
                : 'min-h-0 rounded-full border border-border px-3 py-1.5 font-mono text-[10.5px] text-subtle'
            }
          >
            {t(`language.${language}` as 'language.fr')}
          </button>
        ))}
      </div>
    </div>
  )
}

// --- ▸ DONNÉES --------------------------------------------------------------

function DataSection() {
  const { t } = useTranslation()
  const { state, exportLog, importLog } = useBackup()
  const file = useRef<HTMLInputElement>(null)

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t('settings.dataTitle')}</SectionTitle>
      <Card>
        <Row
          label={t('settings.export')}
          value={state.status === 'exporting' ? '…' : '.log'}
          onActivate={() => void exportLog()}
        />
        <Row
          label={t('settings.import')}
          value={state.status === 'importing' ? '…' : '.log'}
          onActivate={() => file.current?.click()}
        />
      </Card>

      <input
        ref={file}
        type="file"
        accept=".log,text/plain"
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files?.[0]
          event.target.value = ''
          if (chosen) void importLog(chosen)
        }}
      />

      {state.status === 'imported' && (
        <p className="font-mono text-[10.5px] text-accent">
          {t('settings.importReport', {
            added: state.report.added,
            skipped: state.report.skipped,
          })}
        </p>
      )}
      {state.status === 'failed' && (
        <p
          role="alert"
          className="rounded-action border border-border bg-surface px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted"
        >
          ! {t('settings.importFailed', { reason: state.reason })}
        </p>
      )}
    </section>
  )
}

// --- ▸ ZONE DANGEREUSE ------------------------------------------------------

/**
 * Confirmation destructive plein écran — pas de modal dans le système.
 *
 * La protection est l'inversion de proéminence : le CTA plein dégradé est
 * `ANNULER` — le geste protégé a le geste facile — et l'effacement est en
 * outline dessous. Pas de rouge : le rouge est la couleur du statut
 * « abandonné », une couleur de donnée.
 *
 * Le corps dit EXACTEMENT ce qui sera perdu, dont le compte d'événements
 * non poussés — lu dans l'outbox, jamais recalculé ailleurs. La purge
 * inclut la déconnexion : sans elle, la session survivante retélécharge
 * tout au prochain démarrage et le geste est un no-op coûteux.
 */
function PurgeConfirm({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation()
  const { local, live } = usePorts()
  const session = useSession()
  const [purging, setPurging] = useState(false)

  const unpushed = live.usePendingPushCount()
  const pendingAdds = live.usePendingAdds().length
  const blockedCount = unpushed + pendingAdds

  async function purge() {
    if (purging) return
    setPurging(true)
    // La déconnexion d'abord : révoquer la session pendant qu'on sait
    // encore qui on est. La purge efface ensuite tout, curseurs compris.
    if (session.user !== null) await session.clear()
    await local.purgeAll()
    // Rechargement complet, pas une navigation : la table rase doit aussi
    // emporter l'état mémoire — React, moteur de sync, caches. L'app
    // redémarre comme au premier jour, sur la Landing.
    window.location.assign('/')
  }

  return (
    // Par-dessus la coquille, tab bar comprise : un écran plein dans les
    // codes de `Welcome`, pas une page de plus dans l'app.
    <section className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col justify-center gap-5 overflow-y-auto bg-bg px-6 py-10">
      <p className="font-mono text-[11px] tracking-wide text-accent">
        {t('settings.purgeEyebrow')}
      </p>
      <h1 className="font-display text-[25px] font-semibold leading-tight text-text">
        {t('settings.purgeTitle')}
      </h1>
      <p className="text-sm leading-relaxed text-muted">{t('settings.purgeBody')}</p>

      {blockedCount > 0 && (
        <p
          role="alert"
          className="rounded-action border border-border bg-surface px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted"
        >
          ! {t('settings.purgeUnpushed', { count: blockedCount })}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-action bg-gradient-action font-display text-[13px] font-bold tracking-[.5px] text-bg shadow-glow"
        >
          {t('settings.purgeCancel')}
        </button>
        <button
          type="button"
          onClick={() => void purge()}
          disabled={purging}
          className="h-12 rounded-action border border-border-active font-display text-[13px] font-semibold tracking-[.5px] text-text disabled:opacity-40"
        >
          {purging ? t('settings.purging') : t('settings.purgeConfirm')}
        </button>
      </div>
    </section>
  )
}
