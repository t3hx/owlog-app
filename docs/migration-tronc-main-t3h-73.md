# Migration vers un tronc `main` unique — runbook (T3H-73)

Procédure exacte pour basculer owlog du couple `dev`/`main` vers un tronc
`main` unique (workflow solo v3), poser les réglages du dépôt et les secrets,
puis coloniser jj. **À exécuter dans l'ordre, avec les points de contrôle.**

## État de départ (constaté le 2026-08-03)

- `origin/main` (`4e9537a`) contient déjà tout `origin/dev` (`ce7e633`), plus
  7 bulles de merge de PR. `main` n'est donc pas en retard de contenu.
- Le seul travail non publié : **11 commits locaux linéaires sur `dev`**
  (`ce7e633..cd5fc70`), jamais poussés. Plus les changements du pipeline
  T3H-73, encore non commités dans l'arbre de travail.
- Deux worktrees : le principal sur `dev`, et
  `.claude/worktrees/agent-adacd148700fd313e` sur `feat/desktop-layout`
  (**verrouillé**, travail d'agent en vol, `cd5fc70`).

**Garanties de cette procédure :** aucune réécriture de l'historique publié de
`main` (les poussées sont des fast-forwards) ; les SHA des commits validés sont
préservés (merge, pas rebase) ; le worktree verrouillé n'est jamais touché.

---

## Phase 1 — Commiter le pipeline T3H-73

Les fichiers adaptés cette session (encore dans l'arbre de travail) forment un
commit. Stage **chirurgical** : surtout pas `.claude/`, `.playwright-mcp/`, ni
les données sensibles.

```bash
cd /Users/tehx/orca/owlog-app
git add .github/workflows/ci.yml .github/workflows/deploy.yml \
        .github/workflows/release.yml .github/workflows/project-sync.yml \
        .github/ISSUE_TEMPLATE/ \
        release-please-config.json .release-please-manifest.json \
        package.json CLAUDE.md docs/git-workflow-solo-v3.md

git commit -m "ci : adopter le workflow v3 — CI temps 2, deploy 2 images, tronc main"
```

> Le CLAUDE.md qui affirme « tronc main » devient vrai à la fin de ce runbook,
> pas avant. C'est pourquoi ce commit et la bascule (phases 2-4) forment un
> tout : ne pas s'arrêter entre les deux.

Le correctif Cloudflare du runbook VPS est un sujet distinct — commit à part :

```bash
git add docs/runbook-vps-dokploy.md
git commit -m "docs : piège Cloudflare Browser Cache TTL au runbook de déploiement"
```

**Point de contrôle :** `git status` ne doit plus lister que du bruit local
non suivi (`.claude/`, `.playwright-mcp/`). `git log --oneline -3 dev` montre
les deux nouveaux commits en tête.

---

## Phase 2 — Amener le travail sur `main` (fast-forward, sans réécriture)

```bash
git fetch origin
git switch -c main origin/main          # crée le main local au tip publié

# Fusion de dev : préserve les SHA validés et garde cd5fc70 (base du worktree
# verrouillé) atteignable depuis main. --no-ff force une bulle de merge nette.
git merge --no-ff dev \
  -m "chore : réconcilier le travail de dev sur le tronc main (T3H-73)"
```

**Point de contrôle avant de pousser** — rien ne doit surprendre :

```bash
git log --oneline --graph -8            # les 13 commits de dev sous une bulle de merge
git diff --stat origin/main HEAD        # exactement les fichiers attendus, rien de plus
git merge-base --is-ancestor origin/main HEAD && echo "FF OK : main avance sans réécriture"
```

Si `FF OK` s'affiche, la poussée est un fast-forward (non destructif) :

```bash
git push origin main
```

---

## Phase 3 — Réglages du dépôt (gh)

```bash
R=t3hx/owlog-app

# Branche par défaut
gh repo edit $R --default-branch main

# Squash-only : le titre de PR devient le commit du tronc, le corps le message
gh repo edit $R \
  --enable-squash-merge=true \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --squash-merge-commit-title PR_TITLE \
  --squash-merge-commit-message PR_BODY \
  --delete-branch-on-merge=true
```

Protection de `main` — exiger une PR et les deux checks de `ci.yml`
(`verify` + `pr-title`). Solo : zéro relecture requise, admin non bloqué.

> ⚠️ **Gate de plan (constaté 2026-08-03).** Sur un dépôt **privé en plan
> gratuit**, ni la protection classique ni les rulesets ne sont applicables —
> la commande ci-dessous répond `HTTP 403 : Upgrade to GitHub Pro or make this
> repository public`. C'est une limite de facturation, pas une erreur : le
> reste de la phase 3 (branche par défaut, squash-only) passe sans souci.
> Trois voies : (a) **sauter** cette étape — le pipeline fonctionne sans
> enforcement, seul le blocage dur manque, acceptable en solo ; (b) le hook
> `pre-push` local ci-dessous, qui récupère « pas de push direct sur main »
> gratuitement ; (c) **GitHub Pro** (~4 $/mois), puis rejouer la commande
> telle quelle.

```bash
# (c) — uniquement sous GitHub Pro/Team. En gratuit privé : 403 attendu.
gh api -X PUT repos/t3hx/owlog-app/branches/main/protection \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [{ "context": "verify" }, { "context": "pr-title" }]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
JSON
```

**(b) Garde-fou local gratuit — hook `pre-push` anti-push-direct sur `main` :**

```bash
cat > .git/hooks/pre-push <<'SH'
#!/bin/sh
# Refuse une poussée dont la réf distante est main : sur ce dépôt, main ne
# reçoit que des squash-merges de PR, jamais un push direct.
while read _local_ref _local_sha remote_ref _remote_sha; do
  case "$remote_ref" in
    refs/heads/main)
      echo "pre-push: poussée directe sur main refusée — passe par une PR." >&2
      exit 1 ;;
  esac
done
exit 0
SH
chmod +x .git/hooks/pre-push
```

> Le hook est local (non versionné, propre à ce clone). Il ne remplace pas
> l'enforcement serveur — il attrape l'erreur de distraction, pas un
> contournement volontaire (`--no-verify` le saute).

**Point de contrôle :** `gh repo view $R --json defaultBranchRef,squashMergeAllowed`
→ `main` + `true`.

---

## Phase 4 — Secrets et variables Actions

Ne pas tout reposer aveuglément — inventorier d'abord ce qui existe :

```bash
gh secret list --repo t3hx/owlog-app
gh variable list --repo t3hx/owlog-app
```

À poser (source de chaque valeur en commentaire) :

```bash
R=t3hx/owlog-app

# PAT classic (scope repo). Généré sur GitHub → Settings → Developer settings →
# Tokens (classic). Sans lui, le tag de release-please ne déclenche pas deploy.
gh secret set RELEASE_PLEASE_TOKEN --repo $R

# Jeton partagé public — même valeur que OWLOG_SHARED_TOKEN côté API.
doppler secrets get OWLOG_SHARED_TOKEN --project owlog-app --plain | \
  gh secret set OWLOG_SHARED_TOKEN --repo $R

# Dokploy (cf. docs/runbook-vps-dokploy.md §B.7 pour l'obtention)
gh secret set DOKPLOY_URL --repo $R           # FQDN tailnet du panel (http://100.x.y.z:3000)
gh secret set DOKPLOY_TOKEN --repo $R         # clé API Dokploy
gh secret set DOKPLOY_APP_ID_BACK --repo $R   # dernier segment de l'URL du service owlog-api
gh secret set DOKPLOY_APP_ID_FRONT --repo $R  # idem pour owlog-web

# Accès tailnet du runner (Tailscale → OAuth clients, tag:ci)
gh secret set TS_OAUTH_CLIENT_ID --repo $R
gh secret set TS_OAUTH_SECRET --repo $R

# project-sync.yml — probablement déjà posé
gh secret set ADD_TO_PROJECT_PAT --repo $R

# Variable (pas secret) — la sonde publique, route existante, PAS de /healthz
gh variable set APP_HEALTH_URL \
  --body "https://owlog.nspace.link/api/health" --repo $R
```

> `VITE_API_URL=/api` est un littéral dans `deploy.yml`, rien à poser.
> Vérifier que `project-sync.yml` pointe le bon board :
> `users/t3hx/projects/4`.

---

## Phase 5 — Nettoyer `dev`

Une fois `main` poussé et vérifié vert, `dev` n'a plus de raison d'être. Ne
PAS toucher au worktree `feat/desktop-layout` (verrouillé, indépendant).

```bash
git push origin --delete dev            # supprime la branche distante
git branch -D dev                        # supprime la locale (son contenu est sur main)
```

> `feat/desktop-layout` survit : son travail rebasera sur `main` quand l'agent
> aura fini. Sa base `cd5fc70` reste atteignable depuis la bulle de merge.

---

## Phase 6 — Vérifier la chaîne bout en bout (§D.17 → tâche 6)

1. Ouvrir une PR de test (branche `chore/verifier-pipeline` → `main`), titre
   conventionnel. Vérifier que **`verify` et `pr-title` tournent et passent**.
2. Squash-merge. Vérifier que release-please ouvre une **Release PR**.
3. Merger la Release PR → tag `v0.1.0` posé.
4. Vérifier que **`deploy.yml` se déclenche** (preuve que `RELEASE_PLEASE_TOKEN`
   fait son office), pousse les deux images sur GHCR, appelle Dokploy, et que
   la sonde `/api/health` répond 200.

---

## Phase 7 — Coloniser jj (dernier, quand aucun worktree n'est verrouillé)

Reportée exprès : colocaliser pendant qu'un worktree d'agent est verrouillé
perturberait ce travail. À faire quand `git worktree list` ne montre plus que
le principal.

```bash
git worktree list                        # doit être propre avant de continuer
jj git init --colocate
jj bookmark list                          # confirmer que main est importé
```

Ensuite le workflow standard reprend : `jj git fetch && jj new main@origin`.

---

## Rollback

- **Avant `git push origin main`** : tout est local, `git switch dev` et
  supprimer le `main` local suffit ; rien n'est parti.
- **Après la poussée mais avant les réglages** : `main` a avancé en
  fast-forward, aucun historique réécrit — un `git revert` du merge est
  possible, mais inutile tant que rien ne dépend encore de `main`.
- **Réglages `gh`** : réversibles un par un (rebranchement de la branche par
  défaut, suppression de la protection).
