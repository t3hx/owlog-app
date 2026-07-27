# Vérifications avant mise en ligne

Six parcours qu'aucun test unitaire ne couvre. À dérouler **sur un téléphone réel, avec l'app installée depuis l'écran d'accueil**, avant chaque mise en ligne.

Ils se testent mal en navigateur piloté : le service worker, le mode avion et l'installation se comportent différemment en simulation. Si cette liste est oubliée deux fois de suite, c'est le signal pour automatiser — et on saura exactement quoi.

Durée : environ cinq minutes.

**Chaque parcours indique l'étape à partir de laquelle il s'applique.** Avant cette étape, il est `N/A` — on ne le saute pas, il n'existe pas encore. Une liste dont la moitié des items échoue aux premières mises en ligne est une liste qu'on cesse de dérouler.

---

## 1. Installation depuis l'écran d'accueil — *à partir de l'étape 3*

- [ ] Ouvrir le domaine dans le navigateur du téléphone
- [ ] « Ajouter à l'écran d'accueil » est proposé
- [ ] L'app se lance en plein écran, sans barre d'adresse
- [ ] L'icône et le nom sont corrects

**Pourquoi ça compte** : l'installation est la seule atténuation réelle de l'éviction d'IndexedDB. Sans elle, iOS peut effacer l'historique après sept jours d'inactivité.

## 2. Mode avion, ouverture complète — *polices à partir de l'étape 3, bibliothèque à partir de l'étape 10*

- [ ] Activer le mode avion
- [ ] Ouvrir l'app depuis l'écran d'accueil
- [ ] Les polices sont les bonnes (Chakra Petch pour les titres, JetBrains Mono pour les métadonnées) — **pas** des polices système
- [ ] La bibliothèque affiche les titres **et** les affiches
- [ ] La recherche affiche son message d'indisponibilité
- [ ] Un statut modifié hors-ligne persiste après fermeture et réouverture

**Pourquoi ça compte** : des polices système au lieu des bonnes signifie que le precache Workbox est cassé. C'est invisible en ligne.

## 3. File d'ajouts hors-ligne — *à partir de l'étape 4*

- [ ] Toujours en mode avion, taper deux titres dans la recherche
- [ ] L'option « mettre "{texte saisi}" de côté » apparaît pour chacun
- [ ] Le badge « 2 titres à confirmer » s'affiche
- [ ] Couper le mode avion
- [ ] La file s'ouvre sur les résultats de recherche, un tap par titre suffit
- [ ] Les deux titres entrent en bibliothèque avec leurs affiches

**Pourquoi ça compte** : c'est l'objectif produit central. S'il échoue hors-ligne, l'habitude ne se prend pas.

## 4. Titre introuvable dans la file — *à partir de l'étape 4*

- [ ] Hors-ligne, mettre de côté un titre volontairement introuvable (`zzzz`)
- [ ] Revenir en ligne, ouvrir la file
- [ ] La recherche ne renvoie rien, et l'entrée reste dans la file
- [ ] Elle n'est ni supprimée ni devinée en silence : on peut la modifier ou l'abandonner

**Pourquoi ça compte** : rien n'entre dans le store avant confirmation. C'est ce qui garantit qu'aucune référence approximative ne se retrouve dans le journal.

## 5. Bandeau de nouvelle version — *à partir de l'étape 3*

- [ ] Garder l'app ouverte sur le téléphone
- [ ] Déployer une nouvelle version
- [ ] Mettre l'app en arrière-plan puis revenir au premier plan
- [ ] Le bandeau « nouvelle version » apparaît **au retour au premier plan** (une PWA iOS installée est suspendue en arrière-plan : le timer horaire ne s'exécute pas, `visibilitychange` est le seul déclencheur fiable)
- [ ] Un tap recharge et la nouvelle version est bien active — **sans vider le cache**

**Pourquoi ça compte** : c'est le piège identifié dès la conception. Sans `Cache-Control: no-cache` sur `index.html`, un déploiement reste invisible pour les clients existants, indéfiniment.

## 6. Conformité au design, 375px — *pour chaque écran déjà construit*

- [ ] Chaque écran construit est comparé à son prototype dans `design_handoff_owlog/`
- [ ] Les écarts sont corrigés ou consignés

**Pourquoi ça compte** : le design system est verrouillé. Une dérive de deux pixels par écran devient une app qui ne ressemble plus à ce qui a été validé.

---

## Après la mise en ligne

- [ ] Ouvrir `/debug` : `cycles_ouverts_au_delà_du_premier` et `entrées_de_journal / jour`
- [ ] Vérifier le compteur d'événements de type inconnu — il doit rester à zéro tant qu'un seul appareil est en service
- [ ] Exporter le `.log` et vérifier qu'il ne contient aucune ligne de progression
