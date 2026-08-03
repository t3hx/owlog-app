# Amis, profil et identité — spécification d'écrans

Surfaces sociales du sprint temps 3 (T3H-54). Le rituel du projet impose une
session de design avant la session de code ; ceci en est le rendu, sur le
modèle de `reglages.md`. Les écrans 8 et 9 du handoff restent la référence
pixel ; ce document spécifie ce que le handoff ne couvre pas — les états, la
visibilité, l'identité, la suppression de compte — et consigne les
amendements actés au gate /autoplan du 2026-07-31 (D2).

Le système de design ne bouge pas : tokens, typo et composants sont ceux du
handoff. Routes en anglais : `/friends`, `/friends/:pseudo`.

## Ce que ces écrans doivent réussir

**Le profil n'est pas public — il est partagé entre amis.** Décision D2.4 :
pas d'opt-in « profil public ». Le profil complet n'est visible que des amis
et du propriétaire ; **accepter une demande d'amitié vaut consentement de
visibilité**, dans les deux sens. Un non-ami ne voit qu'une carte minimale.
Aucune donnée d'un compte n'est lisible sans relation.

**Aucun état muet.** Chaque écran social a un réseau vide à un moment ; un
« No items found » serait un aveu. Chaque état est spécifié ci-dessous.

## Navigation — la 4e case (décision D2.2)

Le handoff se contredisait (README : « amis » ; design-system : « profil ») ;
le temps 1 avait posé LOG en substitut assumé. Le gate a tranché : **Amis
prend la 4e case**, tab bar et sidebar — `accueil / bibliothèque / stats /
amis`, icône avatar rond, libellé mono 9px. Cette ligne amende la ligne
« Tab bar » de `design-system.md`.

**LOG est relogé, pas supprimé.** La route `/log` est conservée ; l'entrée
vit en tête de l'écran Stats (rangée `voir le log complet ›` sous l'en-tête,
codes de la rangée de réglage). Le commentaire de `navigation.ts` qui
documentait la substitution est mis à jour dans le même commit.

Tant qu'aucune session n'existe, l'onglet Amis mène à un écran d'invitation
(codes de la card « activer la sync » de Réglages) : le social exige un
compte, mais l'onglet n'est jamais mort — il explique.

---

## 1. Écran Amis — `/friends` (écran 8 du handoff)

### Décisions, et pourquoi

**L'ordre du handoff est confirmé : ajout → demandes → amis.** L'actionnable
d'abord. La barre « Ajouter par pseudo… @ » reprend le composant de recherche
omniprésente (barre radius 0 14px 14px 14px, bordure accent) sans les onglets
de type — il n'y a qu'un type de résultat.

**`▸ DEMANDES · N` disparaît à zéro.** Une section vide qui annonce « 0 »
est du bruit ; la section n'existe que s'il y a au moins une demande
entrante.

**Le refus est silencieux côté demandeur.** Le refusé ne reçoit rien : sa
demande reste simplement sans réponse. Toute notification de rejet serait
une cruauté gratuite ; ne pas l'implémenter est une décision, pas un oubli.

### Composition et états

| État | Contenu | Règle |
|---|---|---|
| nominal | barre d'ajout ; `▸ DEMANDES · N` (si N>0) : rangées avatar-initiale + pseudo + ✓ 44px dégradé (accepte) / ✕ 44px outline (refuse) ; `▸ AMIS` : rangées avatar (bordure menthe si activité récente), pseudo, activité mono (`● regarde Severance S02`), `compat N%` mono muted | tap rangée ami = `/friends/:pseudo` |
| réseau vide | eyebrow mono `// COMMUNAUTÉ`, une phrase corps muted (« Ton log est meilleur à plusieurs. »), la barre d'ajout déjà en tête **est** le CTA | pas d'illustration : le système n'en a pas |
| recherche sans résultat | sous la barre : encart erreur système (`!` mono muted) « aucun compte à ce pseudo » | identique pour pseudo inexistant et compte sans pseudo — anti-énumération |
| demande envoyée | dans les résultats de recherche, le bouton `+ AJOUTER` de la rangée devient `demande envoyée` mono muted, inactif | l'état vit sur le bouton, pas en toast |
| hors-ligne | les listes lues du dernier pull s'affichent ; la barre d'ajout est désactivée avec mention mono subtle | même politique que la recherche média |

Desktop ≥1024px : master-detail — liste à gauche, profil dans un panneau
droit 430px. **Même route `/friends/:pseudo`** sur les deux formats ; seul le
rendu change (panneau vs écran). Un deep-link à 1280px ouvre la vue
master-detail avec le profil chargé ; la traversée du breakpoint conserve la
sélection et le scroll.

---

## 2. Profil — `/friends/:pseudo` (écran 9 du handoff)

### Décisions, et pourquoi

**Deux niveaux de réponse, décidés côté serveur.** La projection
`publicProfile()` (whitelist stricte, TDD, dans `packages/domain`) est la
seule source de ce qui sort. Le handler n'assemble pas, ne filtre pas.

**Privé = inexistant.** Un pseudo sans relation d'amitié et un pseudo
inconnu produisent la même réponse 404 et le même écran. Distinguer les
deux offrirait une sonde d'énumération.

### Composition et états

| État | Qui | Contenu | Règle |
|---|---|---|---|
| profil complet | ami, ou soi-même | avatar 76px liseré dégradé, `@pseudo` Chakra Petch, `membre depuis … · N titres loggés` mono, tuiles `✓ vus / ♥ / compat %`, `▸ SES COUPS DE CŒUR` (affiches liserées dégradé), `▸ ACTIVITÉ` (journal mono) | conforme écran 9 ; sur son propre profil, pas de tuile compat (compat avec soi-même n'a pas de sens) et pas de bouton d'action |
| carte minimale | non-ami dont on connaît le pseudo (résultat de recherche) | avatar-initiale, `@pseudo`, `membre depuis …` mono, bouton `+ AJOUTER` plein dégradé 44px — rien d'autre | aucune tuile, aucune activité : rien n'est visible avant l'amitié (D2.4) |
| demande envoyée | non-ami, demande en cours | carte minimale, bouton devenu `demande envoyée` mono muted inactif | pas de relance possible tant que la demande vit |
| introuvable | pseudo inconnu **ou** compte sans relation | page dans les codes de `Welcome` : eyebrow `// COMMUNAUTÉ`, « utilisateur introuvable », CTA outline `retour aux amis` | strictement identique dans les deux cas ; jamais un cul-de-sac |
| activité vide | ami tout neuf | tuiles à zéro (les zéros sont des données), `▸ ACTIVITÉ` remplacé par une phrase mono subtle | pas de section fantôme |

**Compat.** `compat N%` n'est calculée qu'entre amis. Sans recouvrement de
bibliothèques : `compat —` mono subtle — un 0 % serait un mensonge. Jamais
de compat sur la carte minimale.

---

## 3. Identité — le pseudo, dans `▸ PROFIL` de Réglages

Le produit n'a qu'un prénom local ; tout l'écran 8/9 repose sur une identité
sociale qui n'existe pas encore.

### Décisions, et pourquoi

**Le pseudo se crée au premier geste social, pas à l'inscription.** Rangée
`pseudo` dans `▸ PROFIL` (sous `prénom`), composant rangée de réglage
existant : vide tant que non défini (`—` mono subtle). Tout geste social
(recherche, demande) sans pseudo redirige d'abord vers cette rangée avec
une phrase d'explication — le compte sync reste utilisable sans pseudo.

**L'avatar est l'initiale du pseudo**, jamais du prénom : le prénom est
privé, le pseudo est l'identité sociale. Un seul système d'avatar.

| Règle | Détail |
|---|---|
| format | 3-20 caractères, `a-z 0-9 _`, minuscules forcées à la saisie ; affiché préfixé `@` |
| unicité | vérifiée au serveur ; erreur `{ error, code: "pseudo_taken" }` rendue en sémantique d'erreur système (`!` mono muted) sous le champ |
| édition | même geste que le prénom (édition en place, champ `›` + bordure accent) ; le serveur fait autorité |
| aperçu | sous la rangée, lien mono 10px `voir mon profil ›` → `/friends/:pseudo` (son propre profil complet) — la seule façon de consentir en connaissance de cause à ce que les amis verront |

---

## 4. Suppression de compte — `▸ ZONE DANGEREUSE`

La zone dangereuse de `reglages.md` était dessinée pour un geste ; elle en
reçoit un second, sémantiquement opposé. La confusion entre les deux est le
pire accident possible du produit.

### Décisions, et pourquoi

**Deux rangées séparées, libellés contrastés, jamais adjacents à l'export.**
`effacer cet appareil` (existant — purge locale, le compte survit) puis
`supprimer mon compte et mes données serveur` (nouveau — le serveur purge,
les appareils sont déconnectés). Séparateur de card entre les deux ; l'ordre
va du moins au plus destructif.

**La confirmation du compte réutilise le champ code de la Connexion.** Pas
de nouveau pattern : un e-mail de confirmation part (gabarit de
`reglages.md` §5, objet distinct), l'écran plein — codes de `Welcome`,
eyebrow `// ZONE DANGEREUSE` — porte le champ code 56px de `/login` phase 2.
Saisir le code **est** la confirmation ; l'inversion de proéminence
s'applique (CTA plein 48px = `ANNULER`, le geste destructif en outline).

**L'écran dit exactement ce qui meurt et ce qui survit.** Corps muted, deux
listes courtes : meurent — le compte, les événements serveur, les amitiés,
les sessions de tous les appareils ; survivent — les données locales de
chaque appareil, jusqu'à purge locale séparée. Le compte d'événements non
poussés s'affiche s'il est non nul (l'outbox le connaît) : supprimer un
compte avec du travail non poussé mérite une ligne de plus, pas un blocage.

Après suppression : retour Landing, bandeau discret « compte supprimé ».
Les autres appareils découvrent la déconnexion à leur prochaine sync
(sessions révoquées) — leur bandeau est celui de la session expirée de
`reglages.md`, avec la même absence de drame.

---

## 5. Connexion — amendement OAuth (écran 2)

Le prototype montrait Google/Apple/Discord ; le temps 2 les a masqués. Le
gate D1.4 acte **Google + GitHub** — ni Apple ni Discord, pas de cases
fantômes.

| Règle | Détail |
|---|---|
| boutons | deux surfaces 48px pleine largeur, fond `surface` + bordure `border`, hover bordure accent (pattern existant de la card Connexion) ; ordre : Google puis GitHub |
| icônes | monochromes, couleur `text` — jamais les couleurs de marque, qui casseraient la palette nocturne |
| libellés | corps 13.5px : `continuer avec Google` / `continuer avec GitHub` (i18n) |
| position | au-dessus du champ e-mail, séparés par `ou` mono 10px subtle centré — l'OAuth est le chemin court, l'e-mail le chemin universel |
| dégradation | secrets absents côté serveur = boutons non rendus (motif temps 2) ; la card se re-centre sur l'e-mail |
| erreurs | refus provider ou e-mail non vérifié : retour phase e-mail avec encart d'erreur système ; le message du cas « e-mail non vérifié » dit quoi faire (« vérifie ton e-mail chez GitHub puis réessaie ») |
| desktop | card 420px inchangée |

---

## Composants nouveaux

**Rangée sociale.** Ligne ≥ 44px : avatar-initiale 36px (cercle `surface`,
bordure `border`, initiale Chakra Petch ; bordure menthe si activité
récente), pseudo corps 13.5px `text`, seconde ligne mono 10.5px muted
(activité ou `membre depuis`), zone d'action à droite (✓/✕, compat, ou
rien). Sert aux demandes, aux amis et aux résultats de recherche.

**Tuile de profil.** Card du système, compacte : chiffre Chakra Petch 21px,
label mono 10px muted dessous. Trois par rangée (`✓ vus / ♥ / compat`).
Zéro est affiché, `—` quand la valeur n'a pas de sens.

Aucun nouveau token, aucune nouvelle couleur.

## Domaine et DRY

- `publicProfile()` vit dans `packages/domain`, whitelist positive testée en
  TDD ; les tuiles, les coups de cœur et l'activité en sortent tous — aucun
  écran ne recompose depuis les événements bruts côté serveur.
- La carte minimale n'est pas une projection : pseudo + date d'inscription
  viennent de la table utilisateurs, rien du store d'événements.
- L'activité (`● regarde …`) est la même donnée que le LOG — même règle
  d'exclusion des `PROG` intermédiaires (`rules/history.ts`), pas un second
  calcul.
- Les états `demande envoyée / reçue / amis` sont dérivés de la table des
  demandes, jamais dupliqués dans un état local d'écran.
