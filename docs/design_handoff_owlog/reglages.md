# Réglages et parcours de compte — spécification d'écrans

Cinq surfaces hors handoff, sprint temps 2 (F1). Le rituel du projet impose une session de design avant la session de code ; ceci en est le rendu, sur le modèle de `log-global.md` et `retro-datage.md`. Pas de prototype : on compose depuis les tokens.

Le système de design ne bouge pas : tokens, typo et composants sont ceux du handoff. Rien ici ne rediscute le verrou. Les treize décisions de la revue design du plan (§Revue Design) sont actées ; ce document les rend exécutables.

Les cinq surfaces : l'écran Réglages, la phase code de la Connexion, la page d'atterrissage du lien, l'état de premier pull, le gabarit d'e-mail. Routes en anglais, comme les existantes (`/library`, `/log`) : `/settings`, `/login`, `/login/link`.

## Ce que ces écrans doivent réussir

**Le compte reste optionnel, et ça doit se voir.** Le temps 1 fonctionne intégralement sans session ; ces écrans ajoutent la synchronisation sans jamais la faire passer pour un péage. L'utilisateur local qui ouvre Réglages doit y trouver ses affaires — langue, prénom, export — et une *invitation* à la sync, pas un mur de connexion.

**Aucun geste destructif facile, aucun geste utile pénible.** La purge locale est à trois écrans du danger ; changer de langue est à deux taps.

## Entrée : le header change

Le header de l'app se réduit à `logo + engrenage`. L'engrenage — 44 px, `lucide` `Settings`, couleur `icon-dim`, à droite — est l'entrée de `/settings`. Le sélecteur de langue du header meurt : il était temporaire depuis le temps 1, sa place définitive est la section `▸ PROFIL` ci-dessous. La tab bar reste verrouillée à ses 4 onglets.

---

## 1. Écran Réglages — `/settings`

### Décisions, et pourquoi

**Quatre sections `▸`, dans un ordre imposé.** `▸ COMPTE` → `▸ PROFIL` → `▸ DONNÉES` → `▸ ZONE DANGEREUSE`. Le compte d'abord parce que la card de statut sync est l'ancre visuelle de l'écran — c'est elle qui donne une raison de revenir ici. La zone dangereuse dernière et isolée : jamais adjacente à l'export, pour qu'un pouce pressé ne confonde pas « sauvegarder » et « détruire ».

**Une rangée de réglage, pas de listes iOS mimées.** Composant nouveau (voir §Composants) : label en corps, valeur en mono muted. Pas de chevrons décoratifs, pas de groupes gris — ce n'est pas le langage du système.

**Pas de modal, nulle part.** Le système n'en a pas. La confirmation destructive est un écran plein dans les codes de `Welcome` (voir §Composants).

### Composition

| Bloc | Contenu | Règle |
|---|---|---|
| En-tête | `RÉGLAGES` Chakra Petch 25px | pas de barre de recherche : ce n'est pas un écran d'ajout |
| `▸ COMPTE` — connecté | card d'ancrage : statut sync (`✓ à jour` menthe · `N à pousser` jaune · `hors-ligne` muted · erreur en sémantique système), `dernière sync {date}` mono 10px, e-mail du compte mono muted, bouton `se déconnecter` outline | la card reprend les codes des cards du handoff : surface translucide, radius 14px, bordure |
| `▸ COMPTE` — non connecté | card « activer la sync » : une phrase corps muted, CTA plein dégradé 44px `ACTIVER LA SYNC` → `/login` | invitation, pas péage : le reste de l'écran fonctionne sans |
| `▸ COMPTE` — microcopie vie privée | trois phrases mono 10px subtle : où vont les données (VPS personnel), ce que fait la déconnexion, ce que fait la purge | close la « question ouverte » des Risques ; deux langues |
| `▸ PROFIL` | rangée `prénom` (tap = édition en place, champ du système `›` + bordure accent) ; rangée `langue` en chips | connecté, l'édition du prénom fait un upsert serveur : **le serveur fait autorité après connexion** — règle écrite, trois sources d'ambiguïté fermées |
| `▸ DONNÉES` | rangée `exporter mon .log` ; rangée `importer un .log` avec rapport `{added} ajoutés · {skipped} ignorés` mono | reprend l'existant de `/debug` (`useBackup`), qui devient la maison de ces gestes ; `/debug` garde ses outils de développement |
| `▸ ZONE DANGEREUSE` | card isolée, marge haute doublée : rangée `effacer mes données locales` → écran de confirmation | la purge **inclut la déconnexion** ; après purge → Landing |

Session expirée : bandeau au-dessus de la tab bar, pattern `UpdateBanner` réutilisé tel quel (position, surface, bordure accent). **Un seul bandeau à la fois, la mise à jour d'app est prioritaire** — deux bandeaux empilés cacheraient la tab bar.

---

## 2. Connexion — `/login`, deux phases d'une même card

Le prototype du handoff couvre la phase e-mail ; les boutons OAuth sont **masqués** (différés, la section providers est exclue du critère de conformité) et la card se re-centre sur l'e-mail. S'ajoutent : la microcopie « union assumée » — sous le champ e-mail, mono 10px subtle, *uniquement quand des données locales existent* — et la phase code.

### Décisions, et pourquoi

**Même card, deuxième état — pas une navigation.** Une route dédiée au code perdrait l'adresse saisie et le contexte visuel ; l'utilisateur doit voir *où* le code a été envoyé pour détecter une faute de frappe. D'où l'adresse rappelée en mono muted, avec `corriger l'adresse` qui ramène à la phase 1 sans rien perdre.

**Le champ code est l'élément dominant de l'écran.** JetBrains Mono, généreux, bordure accent + préfixe `›` — le moment est important, le champ doit le dire. `inputmode=numeric` (le code est en chiffres, alphabet non ambigu), `autocomplete=one-time-code` (iOS le propose depuis Mail), normalisation au collage (espaces et tirets retirés), **auto-envoi à longueur atteinte** — taper la sixième touche valide, le CTA n'est que le secours.

**Le renvoi est freiné visiblement.** `renvoyer` vit sous un compte à rebours mono (rate-limit serveur) : un lien muet qui échoue en silence produirait trois e-mails et de la méfiance.

### Composition — phase code

| Bloc | Contenu | Règle |
|---|---|---|
| Rappel | `code envoyé à {adresse}` mono 10.5px muted | l'adresse en `text`, le reste en muted |
| Champ code | JetBrains Mono 21px, letter-spacing généreux, hauteur 56px, bordure accent + `›`, glow | auto-envoi à longueur atteinte |
| CTA | `VALIDER` plein dégradé 48px | secours de l'auto-envoi |
| Sous le CTA | `renvoyer le code` mono 10px — sous compte à rebours `renvoyer dans {n}s` en subtle | actif : couleur accent |
| Échappatoire | `corriger l'adresse` mono 10px muted | retour phase 1, adresse conservée |
| Erreur | code faux : sémantique d'erreur système (§Composants), essais restants affichés | après 5 essais, le jeton est verrouillé : retour phase 1 avec message |

---

## 3. Page d'atterrissage du lien — `/login/link`

Le secours du code : le lien de l'e-mail. Trois états d'une page plein écran, codes de `Welcome` (eyebrow mono, titre Chakra Petch, corps muted).

**Le lien ne se consomme jamais au GET.** La page se charge, *puis* fait `POST /auth/verify` — les scanners d'e-mail (SafeLinks, antivirus) suivent les liens et brûleraient un jeton à usage unique avant l'humain. L'état « en cours » est donc réel, pas cosmétique.

| État | Contenu | Suite |
|---|---|---|
| en cours | eyebrow `// CONNEXION`, une phrase | POST en vol |
| connecté | `✓` accent + phrase | → premier pull s'il y a des événements distants, sinon → accueil |
| expiré / invalide | phrase en sémantique d'erreur système + CTA outline `recevoir un nouveau code` → `/login` | jamais de cul-de-sac |

---

## 4. Premier pull — plein écran

Après la première connexion d'un appareil, si le serveur a des événements. **Jamais d'accueil vide sous « Bonsoir » pendant le pull initial** : un tracker qui affiche zéro titre à l'utilisateur qui vient précisément de connecter son historique est un écran qui ment.

| Bloc | Contenu | Règle |
|---|---|---|
| Eyebrow | `// SYNCHRONISATION` mono 11px accent | codes de `Welcome` |
| Compteur | `{n}` Chakra Petch 44px dégradé text-clip + `événements récupérés` mono 10px muted | la pagination par 500 donne le compteur gratuitement ; un compteur qui monte, pas une barre — le total n'est connu qu'à la fin |
| Fin | transition vers l'accueil peuplé | pas d'étape « terminé » à valider : l'accueil peuplé *est* la confirmation |

L'échec en cours de pull affiche la sémantique d'erreur système + `réessayer` outline ; les pages déjà tirées sont acquises (le curseur a avancé), le bouton reprend où on en était.

---

## 5. Gabarit d'e-mail — fr/en

C'est un écran du parcours, pas un détail d'adaptateur : c'est la seule surface d'Owlog qui s'affiche dans le client mail d'autrui.

**Le CODE d'abord, gros, mono ; le lien en secours dessous.** Le cas dominant est le va-et-vient Mail → PWA sur le même appareil : on retient six chiffres, on ne clique pas. Le lien sert quand le mail est lu ailleurs.

| Bloc | Contenu | Règle |
|---|---|---|
| Objet | `{code} — ton code de connexion Owlog` | le code dans l'objet : visible en notification, sans ouvrir |
| Corps | le code, mono, très gros, letter-spacing large | HTML monocolonne, styles inline, sans images — les clients mail ne rendent ni fonts web ni thème sombre fiablement : fond neutre, pas de reproduction du thème nocturne |
| Secours | `ou clique : {lien}` | le lien atterrit sur `/login/link` |
| Pied | une phrase : expiration + « ignorer si ce n'était pas toi » | deux langues ; la langue de l'e-mail suit celle de l'app au moment de la demande |

---

## Composants nouveaux

**Rangée de réglage.** Ligne ≥ 44px dans une card du système : label corps 13.5px `text` à gauche, valeur JetBrains Mono 10.5px `muted` à droite. Tap = le geste de la rangée (édition en place, déclenchement, navigation). Séparateur `border` entre rangées d'une même card. Aucun chevron par défaut : la valeur *est* l'indice d'interactivité.

**Chips de langue.** Le pattern `FilterChips`, réduit à deux : `français` · `english`, pill mono 10.5px. Active : `border-active` + fond surface + `text` — les codes de la chip `tous` de la bibliothèque, pas ceux des statuts : une langue n'a pas de couleur sémantique.

**Confirmation destructive plein écran.** Pas de modal dans le système. Un écran dans les codes de `Welcome` : eyebrow `// ZONE DANGEREUSE`, titre Chakra Petch, corps muted qui dit *exactement* ce qui sera perdu — dont **le compte exact d'événements non poussés** (l'outbox le connaît). La protection est l'inversion de proéminence : le CTA plein dégradé 48px est `ANNULER` (le geste protégé a le geste facile) ; dessous, `EFFACER MES DONNÉES` en outline `border-active`, texte `text`. Pas de rouge : voir ci-dessous.

**Sémantique d'erreur système.** Le rouge `#FF5E5E` reste réservé au statut « abandonné » — c'est une couleur de *donnée*, pas d'alarme. L'erreur système (code faux, pull échoué, lien expiré) s'écrit en JetBrains Mono 10.5px `muted`, dans un encart `border` + surface, préfixe `!`. Aucun nouveau token : la gravité est portée par les mots, pas par une couleur qui diluerait celle du statut.

## Domaine et DRY

- L'export/import ne se réécrit pas : `useBackup` et le rapport `{added, skipped}` de `restore()` existent ; Réglages devient leur maison, `/debug` garde ses outils de développement.
- Le compte d'événements non poussés de la confirmation destructive vient de l'outbox (`pending_push`), pas d'un second calcul.
- `first_name` : le serveur fait autorité après connexion ; l'édition fait l'upsert, l'écran ne garde aucune copie locale divergente.
- La langue reste en `localStorage` (`owlog.language`), comme documenté : elle doit être connue avant le premier rendu. Les chips ne font que déplacer le geste, pas le stockage.
