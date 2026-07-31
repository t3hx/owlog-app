# Import TVTime — spécification d'écrans

Wizard d'import du sprint temps 3 (T3H-54). Session de design avant la
session de code, sur le modèle de `reglages.md`. Surface entièrement hors
handoff : tout se compose depuis les tokens. Les décisions du gate /autoplan
(D1.3 : vraie feature Réglages ; revue design F4 : fin en apothéose,
ambiguïtés en lot) sont actées ici.

Entrée : rangée `importer depuis TVTime` dans `▸ DONNÉES` de Réglages, sous
l'import `.log`. Une seule route de travail, plein écran, dans les codes de
`Welcome`/`FirstPull` — le wizard est un parcours, pas un formulaire.

## Ce que cet écran doit réussir

**C'est le meilleur moment que le produit offrira jamais à cet utilisateur.**
Neuf ans d'historique — 11 648 épisodes, 175 films — deviennent des stats
vivantes. La fin du parcours doit le montrer, pas l'archiver dans un rapport.

**Rien ne s'écrit sans avoir été montré.** Le store est append-only : une
erreur d'import se corrige par des milliers de VOID. Le dry-run n'est pas un
écran de confort, c'est la digue. Aucune ligne n'est ignorée en silence.

## Le parcours — quatre temps

```
choisir les fichiers ─▶ analyse ─▶ DRY-RUN (la digue) ─▶ écriture ─▶ fin
                          │              │                   │
                          ▼              ▼                   ▼
                     fichier non    ambiguïtés réglées   interruption =
                     reconnu =      EN LOT, jamais en    reprise, jamais
                     rejet loud     file bloquante       de doublon
```

---

## 1. Choix des fichiers

| Bloc | Contenu | Règle |
|---|---|---|
| Eyebrow | `// IMPORT TVTIME` mono 11px accent | codes de `Welcome` |
| Titre | `Ton historique TVTime` Chakra Petch 25px | |
| Corps | deux phrases muted : quoi exporter chez TVTime (demande GDPR), quels fichiers donner ici | lien mono vers l'aide TVTime ; c'est la seule doc — pas de tutoriel |
| Sélecteur | zone de dépôt card en pointillés `border`, tap = picker multi-fichiers (`.csv`) | accepte le dossier décompressé entier : l'app trie elle-même les fichiers utiles (`tracking-prod-records-v2`, `tracking-prod-records`, `user_tv_show_data`, `followed_tv_show`) et ignore le reste — l'utilisateur n'a pas à connaître la structure de l'export |
| Erreur | aucun fichier utile trouvé : encart d'erreur système (`!` mono muted) « ces fichiers ne ressemblent pas à un export TVTime », liste mono des fichiers attendus | rejet loud, jamais un import vide silencieux |

L'analyse (parse + réconciliation + résolution TMDB par lots via `/find`)
tourne sous un compteur mono discret (`{n} lignes lues`). Réseau coupé
pendant la résolution : encart d'erreur + `réessayer` outline — les lots
déjà résolus sont acquis (cache de mapping serveur), le bouton reprend.

---

## 2. Dry-run — la digue

Rien n'est encore écrit. Trois sections `▸`, comptes en tête de section,
dans cet ordre :

| Section | Contenu | Règle |
|---|---|---|
| `▸ PRÊTS · N` | résumé compact : `N séries · N épisodes · N films · N ♥` en tuiles (chiffre Chakra Petch 21px, label mono 10px) ; dépliable en liste de rangées média (affiche placeholder, titre, `S/E · dates` mono) | replié par défaut — le détail est disponible, pas imposé |
| `▸ À CONFIRMER · N` | **résolution en lot** : une rangée par film ambigu — titre TVTime mono à gauche, à droite 2-3 candidats TMDB en chips (affiche mini + année) ; tap = choix, `aucun` en dernière chip | jamais une file de dialogues bloquants ; on peut tout laisser sur le choix par défaut (meilleur score) et corriger après coup — les non-choisis explicites partent en « ignorés » |
| `▸ NON RÉSOLUS · N` | liste mono muted des lignes sans correspondance TMDB, avec la raison courte (`série inconnue`, `date invalide`) | comptés et visibles, jamais tus ; réimportables plus tard |
| CTA | `IMPORTER {N} VISIONNAGES` plein dégradé 48px, collé bas | le chiffre dans le bouton : on sait ce qu'on signe |
| Secours | `annuler` mono 10px muted | retour Réglages, rien n'est écrit |

Sections à zéro : masquées (règle `▸ DEMANDES · 0` de `social.md`). Si tout
est prêt sans ambiguïté ni échec, le dry-run est un seul bloc de tuiles et
un bouton — le cas heureux est court.

---

## 3. Écriture — le compteur

Reprise du motif `FirstPull` de `reglages.md`, à l'identique : **un compteur
qui monte, pas une barre** — même si le total est ici connu, deux patterns de
progression concurrents seraient un token de plus ; le compteur est le
pattern du système.

| Bloc | Contenu | Règle |
|---|---|---|
| Eyebrow | `// IMPORT TVTIME` mono accent | |
| Compteur | `{n}` Chakra Petch 44px dégradé text-clip + `visionnages importés` mono 10px muted | avance par lots d'écriture (`restore()`) |
| Garde | pas de bouton annuler pendant l'écriture | l'écriture par lots idempotents rend l'interruption sûre mais l'inviter serait absurde : elle dure quelques secondes |

**Interruption (onglet fermé, app tuée) : la reprise est un réimport.** Le
calcul est déterministe et l'écriture idempotente — au retour, Réglages
montre le rapport partiel avec `reprendre l'import` outline ; reprendre
rejoue tout et ne duplique rien. Aucun état « corrompu » n'est possible, et
l'écran ne parle donc jamais de corruption.

---

## 4. Fin — l'apothéose

**Jamais un toast, jamais un retour sec à Réglages.** Écran plein, codes de
`FirstPull` :

| Bloc | Contenu | Règle |
|---|---|---|
| Eyebrow | `// IMPORT TERMINÉ` mono accent | |
| Chiffre | `11 648` Chakra Petch 44px dégradé text-clip + `épisodes retrouvés · 9 ans de log` mono muted | la seconde ligne calcule l'empan réel (`min(occurred_at) → max`) — c'est elle qui donne le vertige |
| CTA | `VOIR MES STATS` plein dégradé 48px → `/stats`, période « tout » | les stats peuplées **sont** la confirmation, comme l'accueil peuplé l'était pour le premier pull |
| Secours | `retour aux réglages` mono 10px muted | |

Si des lignes ont été ignorées ou non résolues, une ligne mono muted sous le
chiffre : `{n} lignes ignorées — détail dans réglages` — la fête n'est pas
interrompue, le détail a une adresse.

---

## 5. Rapport persistant — dans `▸ DONNÉES`

Après un import, la rangée `importer depuis TVTime` gagne une seconde ligne
mono 10.5px muted : `dernier import {date} · {créés} créés · {ignorés}
ignorés · {non résolus} non résolus`. Tap sur la rangée : le détail (les
listes du dry-run, en lecture) puis la proposition de réimporter.

C'est le pendant du rapport `{added} ajoutés · {skipped} ignorés` de
l'import `.log` — même position, même langage. Un réimport du même export
affiche `0 créés` : la preuve visible de l'idempotence.

---

## Composants nouveaux

**Tuile de compte.** La tuile de profil de `social.md`, réutilisée telle
quelle (chiffre Chakra Petch 21px + label mono) — un seul composant de
« gros chiffre » dans le système.

**Rangée d'ambiguïté.** Ligne de card : titre source mono 10.5px `text` à
gauche, chips candidates à droite (mini-affiche 24×36 + année mono 9px,
bordure `border`, choisie = `border-accent` + fond surface). C'est le
pattern des chips de langue, porté à des candidats.

Aucun nouveau token. La progression réutilise le compteur `FirstPull` ;
les erreurs, la sémantique d'erreur système de `reglages.md`.

## Domaine et DRY

- Le calcul (parse, réconciliation, compaction, ids) est **pur et complet
  avant toute écriture** — le dry-run affiche le résultat exact de ce qui
  sera écrit, pas une estimation. Spec de compaction : sortie du spike
  T3H-56.
- L'écriture passe par `restore()` par lots — le même chemin idempotent que
  l'import `.log`, jamais `bulkAdd` via les commandes.
- La résolution TMDB passe par `/find` batch serveur et sa table de mapping
  (T3H-68) ; le client ne parle jamais à TMDB.
- Le rapport persistant est stocké une fois (settings Dexie), les écrans le
  lisent — pas de recomptage.
- i18n intégrale fr/en ; les nombres formatés par la locale
  (`11 648` / `11,648`).
