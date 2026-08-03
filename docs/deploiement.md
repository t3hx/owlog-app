# Comment je mets Owlog en ligne

Une seule mécanique, la même sur tous mes projets. Je ne pousse jamais sur
`main` directement — tout passe par une PR, et **fusionner la PR met l'app en
ligne**.

## Le parcours, à chaque changement

```bash
git switch -c feat/ma-fonctionnalite   # 1. brancher depuis main
# ... je code ...
git push -u origin feat/ma-fonctionnalite   # 2. pousser la branche
gh pr create --fill                          # 3. ouvrir la PR
```

4. **La CI tourne toute seule** sur la PR (`verify` = lint + build + tests ;
   `pr-title` = le titre est un commit conventionnel valide). J'attends le vert.
5. **Je squash-merge** la PR (bouton *Squash and merge*, ou `gh pr merge --squash`).

À la seconde où la PR est fusionnée, **tout le reste est automatique** :

```
squash-merge sur main
   → build des 2 images (owlog-web + owlog-api) sur GitHub
   → poussée sur GHCR (ghcr.io/t3hx/owlog-web · owlog-api, tag `latest`)
   → appel à Dokploy : tire les nouvelles images et redémarre
   → vérifie que https://owlog.nspace.link/api/health répond 200
```

Je n'ai **rien** d'autre à faire. Pas de tag, pas de « Release PR », pas de
version à penser. Si le déploiement échoue, le workflow `deploy` est rouge dans
l'onglet Actions et je le vois ; l'ancienne version reste en ligne tant que la
nouvelle n'est pas saine.

## Le titre de la PR (la seule règle à retenir)

Le titre devient le commit sur `main`, donc il doit être conventionnel :
`type: description`, **deux-points collés au type**.

- `feat: ajouter le filtre par saison`
- `fix: corriger le cache des affiches`
- `docs: mettre à jour le runbook`

Types valides : `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`,
`build`, `ci`, `chore`, `revert`. La description reste en français ; **pas
d'espace avant les `:`** (`feat :` casse le lint).

## Ce qui est déjà en place (à ne pas refaire)

- Branche par défaut `main`, fusion en squash uniquement.
- Hook local `pre-push` : refuse une poussée directe sur `main`.
- Secrets GitHub posés une fois : `OWLOG_SHARED_TOKEN`, `DOKPLOY_URL/TOKEN`,
  `DOKPLOY_APP_ID_BACK/FRONT`, `TS_OAUTH_CLIENT_ID/SECRET`, `ADD_TO_PROJECT_PAT` ;
  variable `APP_HEALTH_URL`.

## Si un déploiement casse

Corriger en avant : une nouvelle PR `fix:` qui, une fois fusionnée, redéploie.
En dépannage, Dokploy permet aussi de re-déployer manuellement l'image
précédente (tag par SHA disponible sur GHCR).
