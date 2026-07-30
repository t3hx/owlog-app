# Handoff : Owlog — PWA de tracking média

## Overview
Owlog est une PWA mobile-first de suivi de contenus médias (films et séries au lancement, extensible : animes, livres, audiobooks, musique). Objectif produit central : **ajouter un contenu avec le moins de clics possible** (recherche omniprésente, ajout en 1 tap). Ambiance nocturne épurée, cyberpunk sobre, dimension « log informatique » subtile. Langue de l'interface : **français**.

## About the Design Files
Les fichiers de ce dossier sont des **références de design créées en HTML** (prototypes montrant l'apparence et le comportement attendus), pas du code de production à copier tel quel. La tâche consiste à **recréer ces designs dans l'environnement du codebase cible** (React, Vue, Svelte, natif…) avec ses patterns et bibliothèques établis — ou, si aucun environnement n'existe encore, à choisir le framework le plus adapté (une PWA React/Next ou SvelteKit est un bon défaut) et à y implémenter ces écrans.

Les fichiers `.dc.html` s'ouvrent dans un navigateur : le markup utile est dans la balise `<x-dc>` (styles inline) et la logique du prototype dans le `<script data-dc-script>` (classe `Component`, pseudo-React).

## Fidelity
**High-fidelity (hifi)** : couleurs, typographies, espacements, rayons, glows et copies sont finaux et validés par le product owner. Recréer l'UI au pixel près avec les valeurs ci-dessous. Les affiches/backdrops sont des placeholders hachurés → à remplacer par les visuels des APIs (TMDB…).

## Design Tokens

### Couleurs
- `bg` : `#070A12` (fond app)
- `surface` : `#121724` · surface translucide : `rgba(18,23,36,.75)` · tab bar : `rgba(10,14,23,.9)`
- `border` : `#212A3D` · border active : `#2C3448` · border accent : `rgba(39,255,147,.35)`
- `text` : `#EAEEF2` · `muted` : `#8A8F9C` · `subtle` : `#5F6474` · icônes inactives : `#4D5468`
- `accent` (menthe) : `#27FF93` · `bleu` : `#2F7BFF`
- Statuts : à voir jaune `#FFD64A` · en cours menthe `#27FF93` · vu bleu `#7EB0FF` · abandonné rouge `#FF5E5E`
  - Chips pill : fond = couleur à 10-12 % d'alpha, bordure = couleur à 40-45 % d'alpha
- **Dégradés (toujours 90deg)** :
  - actions (bouton play, REVOIR, icône nav active, CTA) : `linear-gradient(90deg,#27FF93,#2F7BFF)` (menthe→bleu)
  - progression : `linear-gradient(90deg,#2F7BFF,#27FF93)` (bleu→menthe)
- Glow : `0 0 12px→18px rgba(39,255,147,.35)` sur les éléments accent
- Halo de page : `radial-gradient` menthe à 70%/-10% + bleu à 15%/-10%, très faible alpha (.10-.14)
- Placeholder d'affiche : `repeating-linear-gradient(-45deg,#1A2032,#1A2032 6px,#151A29 6px,#151A29 12px)`

### Typographie (Google Fonts)
- **Chakra Petch** (600-700) : logo (letter-spacing 1px, O du milieu en menthe + glow), titres d'écran 25px, titres de section 13-15px MAJUSCULES préfixe « ▸ » letter-spacing .5px, gros chiffres stats (44px)
- **IBM Plex Sans** (400-600) : corps 13.5-15px, titres de contenu 14-15px/600
- **JetBrains Mono** (400-600) : toutes les métadonnées/data (9-11px, couleur muted), labels de nav (9px mobile / 11px desktop), chips, journal

### Rayons & dimensions
- Cards : 14px · boutons/actions : 12px · onglets de recherche : 10px 10px 0 0 · barre de recherche : 0 14px 14px 14px · chips : 999px · affiches : 8-10px
- Hit targets mobiles ≥ 44×44px · affiches ratio 2:3 (104×156 grille, 48×72 rangée, 96×144 page média)

## Screens / Views

### 1. Landing (non connecté)
Navbar simple (logo + bouton « se connecter » outline), pas de tab bar ni de recherche. Hero : eyebrow mono menthe `// FILMS · SÉRIES · ET BIENTÔT PLUS`, titre Chakra Petch « Tout ce que tu regardes. Un seul log. » (mot « log » en dégradé text-clip), sous-titre muted, CTA plein dégradé « COMMENCER — C'EST GRATUIT » + microcopie mono « sans carte · données exportables · api tmdb », 3 features (+ Ajout en un tap / ↻ Journal & revisionnages / % Stats à ton image), footer mono. Desktop : hero 2 colonnes avec capture de l'app à droite.

### 2. Connexion
Multi-provider : Google / Apple / Discord (boutons surface 48px, hover bordure menthe), séparateur « ou par e-mail », champ e-mail (bordure accent + préfixe `›` menthe), CTA dégradé « RECEVOIR LE LIEN MAGIQUE » (auth sans mot de passe, magic link), légal en mono. Desktop : card centrée 420px.

### 3. Accueil (app)
Recherche omniprésente en tête (voir Composants), « Bonsoir, {prénom} » + sous-ligne mono `› N en cours · N à voir`. Section ▸ EN COURS : rangées avec affiche 56×84, titre, `S02E05 · 62%`, barre de progression 4px (dégradé bleu→menthe), bouton play 44px dégradé (avance la progression). Section ▸ À VOIR : rangée horizontale scrollable d'affiches 104×156.

### 4. Résultats de recherche
Affichés dès que la requête est non vide, à la place du contenu de l'onglet. Compteur mono `N résultats · {type} · tmdb`. Deux groupes : **▸ DÉJÀ DANS TA BIBLIOTHÈQUE** (rangées avec leur statut) puis **▸ RÉSULTATS** (API) avec bouton **+ 44px** (bordure menthe) = **ajout direct en « à voir »** ; appui long = choisir le statut. Légende mono en pied.

### 5. Bibliothèque
Titre + compteur. Filtres en chips : `tous · N`, `+ à voir · N`, `● en cours · N`, `✓ vu · N`, `✕ abandonné · N`, `♥ coups de cœur · N` (chip ♥ : bordure ET texte en dégradé, jamais de fond plein). Rangées média : affiche 48×72, titre, méta mono, étoiles si noté, barre de progression si en cours, ♥ dégradé à gauche de la pastille, **pastille de statut cliquable (tap = statut suivant, appui long = menu)**. Desktop : liste en colonnes TITRE / TYPE / PROGRESSION / NOTE / STATUT (en-têtes mono 9.5px `#5F6474`).

### 6. Page média
Backdrop 16:9 fondu vers le fond (`linear-gradient(180deg, rgba(7,10,18,.25), .55 60%, #070A12)`), retour ← et ⋯ en overlay 36px. Affiche 96×144 en surimpression (**liseré dégradé 1px + glow si coup de cœur**), titre Chakra Petch 21px, méta mono. Rangée des 4 statuts (chips cliquables, active = fond alpha). Ligne note : 5 étoiles tapables (menthe/`#2C3448`) + label, **toggle ♥ 44px sans contour** (♥ dégradé si actif, ♡ `#4D5468` sinon), notes externes mono à droite (`tmdb 8.2 · letterboxd 4.3`). Si statut « vu » : **bouton plein dégradé 44px « ↻ REVOIR »** → repasse en « en cours » et ouvre un nouveau cycle. Synopsis, genres en tags mono. **▸ JOURNAL** : entrées mono datées, `border-left #212A3D`, groupées par marqueurs `— visionnage #N —`. Desktop : journal en panneau latéral 330px.

### 7. Stats
Sélecteur de période (30j / année / tout). Card héros TEMPS TOTAL : `142h` en dégradé text-clip 44px + delta `▲ +18h vs 2025` + légende films/séries. ▸ RÉPARTITION : barre empilée 10px (séries menthe / films bleu) + pourcentages. Tuiles : ✓ vus (bleu) / ● en cours (menthe) / ♥ (dégradé). ▸ NOTES : **donut** `conic-gradient` (★4-5 menthe / ★3 jaune / ★1-2 rouge) avec moyenne `★3.8` au centre + légende + ligne `complétion 79% · revisionnages ×4 · 214 ép. vus`. ▸ GENRES FAVORIS : barres 4px dégradé + % mono. **Toutes les valeurs sont calculées depuis les données utilisateur.**

### 8. Communauté (Amis)
Barre « Ajouter par pseudo… @ ». ▸ DEMANDES · N : rangées avec ✓ (44px dégradé, accepte) et ✕ (44px outline, refuse). ▸ AMIS : avatar initiale (bordure menthe si activité live), pseudo, activité récente mono (`● regarde Severance S02`), `compat N%`. Tap = profil public. Desktop : master-detail (liste + profil dans un panneau droit 430px).

### 9. Profil public utilisateur
Avatar 76px à liseré dégradé, `@pseudo` Chakra Petch, `membre depuis… · N titres loggés` mono, bouton + AJOUTER dégradé (si pas ami), tuiles ✓ vus / ♥ / compat %, ▸ SES COUPS DE CŒUR (affiches liserées dégradé), ▸ ACTIVITÉ (journal mono).

## Composants transversaux

### Recherche omniprésente (composant clé)
Présente sur accueil et bibliothèque (desktop : en tête de contenu, 520px, raccourci ⌘K). **Onglets « dossier » de type média AU-DESSUS de la barre** : `tout / films / séries / +` (le + annonce les futurs types). L'onglet actif **fusionne** avec la barre : même fond `#121724`, `border-bottom:none`, `margin-bottom:-1px`, radius `10px 10px 0 0` ; la barre a un radius `0 14px 14px 14px`, une bordure accent et un glow discret. Le placeholder reflète le type : « Ajouter ou rechercher dans {type}… » (bibliothèque : « Filtrer ou ajouter dans {type}… »). Icône loupe dessinée en CSS (cercle + trait menthe). Un seul appel API par type sélectionné.

### Navigation
Mobile : tab bar basse fixe `rgba(10,14,23,.92)` + blur — accueil / bibliothèque / stats / amis, labels mono 9px, icône active = carré 22px en dégradé + glow, label menthe. Desktop (≥1024px) : sidebar gauche 216px (logo, items nav 11px mono avec fond `#121724` si actif, chip utilisateur en bas), la tab bar disparaît.

### Statuts (modèle)
`watch (+ à voir)` → `current (● en cours)` → `seen (✓ vu ×N)` → `dropped (✕ abandonné)`. Tap sur pastille = statut suivant (cycle), appui long / clic droit = menu. Chaque changement écrit une entrée de journal datée.

### Coup de cœur ♥ (règles strictes)
- **Pas un statut** : marqueur transversal cumulable avec tout statut, ne remplace jamais la pastille
- Seul élément non-action autorisé à utiliser le dégradé
- Affiche du média ♥ : liseré dégradé 1px + glow léger (technique : `border:1px solid transparent; background: <stripes/image> padding-box, linear-gradient(90deg,#27FF93,#2F7BFF) border-box`) — jamais sur la card conteneur, pas de badge
- Rangée : glyphe ♥ dégradé (background-clip:text) à gauche de la pastille de statut
- Page média : toggle 44px sans contour · Filtre : chip bordure + texte dégradé, jamais de fond plein

### Revisionnage ↻
Bouton « ↻ REVOIR » (plein dégradé) sur la page média des titres vus : statut → « en cours », `cycle+1`, insère un marqueur `— visionnage #N —` dans le journal. Le statut vu affiche `✓ vu ×N`.

## Interactions & Behavior
- Ajout depuis résultats : 1 tap sur + → statut « à voir » + entrée journal (feedback : bordure menthe + « ✓ ajouté », lien annuler)
- Hover desktop : bordures passent à `#2C3448` ou menthe, glows intensifiés ; curseur pointer sur tout élément actionnable
- Recherche : filtrage live à la frappe ; ✕ efface ; le type sélectionné filtre les résultats
- Étoiles : tap = note, re-tap sur la même = efface
- Play (en cours) : avance la progression ; à 100 % → passe « vu » (+1 visionnage)
- Transitions douces (150-200ms ease) sur bordures/glows ; pas d'animations lourdes

## State Management
- `media[]` : {id, title, type, meta, genres[], hours, status, rating 0-5, fav, progress 0-100|null, progressLabel, seenCount, cycle, journal[]}
- `journal[]` : entrées {date, label, color} + marqueurs de cycle — toujours en unshift (plus récent en haut)
- UI : écran (landing/login/app), onglet actif, requête + type de recherche, filtre bibliothèque, média sélectionné, ami consulté, breakpoint desktop (matchMedia 1024px)
- `friends[]`, `requests[]` ; stats dérivées (jamais stockées) : heures, répartitions, moyenne, donut, genres
- Données réelles : TMDB (films/séries) ; prévoir OpenLibrary/Spotify pour les futurs types

## Assets
Aucun asset binaire. Affiches/backdrops = placeholders hachurés à remplacer par les images des APIs. Logo = wordmark texte « OWLOG » (Chakra Petch 700, O menthe + text-shadow). Icônes dessinées en CSS ou à remplacer par une lib d'icônes fine (lucide) en gardant les tailles.

## Files
- `Owlog Prototype.dc.html` — **prototype interactif complet** (parcours landing → login → app, tout l'état) : la référence de comportement
- `Owlog Design System.dc.html` — page de référence du design system (tokens, composants, règles ♥/revoir)
- `Owlog Explorations.dc.html` — canvas d'itérations validées (turns 4-10 : tous les écrans mobile + desktop, dont résultats de recherche et page média détaillés)
- `design-system.md` — résumé texte des tokens et règles (copie du CLAUDE.md du projet)
