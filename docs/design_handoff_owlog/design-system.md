# Owlog — design system verrouillé (option 3a)

PWA mobile-first de tracking média (films/séries d'abord, extensible : animes, livres, audiobooks, musique). Langue : français. Ambiance nocturne épurée, cyberpunk sobre, dimension "log" subtile (mono pour les métadonnées, pas de gimmick terminal).

## Tokens
- bg: #070a12 · surface: #121724 · surface-translucide: rgba(18,23,36,.75) · tabbar: rgba(10,14,23,.9)
- border: #212a3d · border-active: #2c3448 · border-accent: rgba(39,255,147,.35)
- text: #eaeef2 · muted: #8a8f9c · subtle: #5f6474 · icon-dim: #4d5468
- accent (menthe): #27ff93 · bleu: #2f7bff
- dégradés (toujours 90deg): actions (play, icône tab active) linear-gradient(90deg,#27ff93,#2f7bff) menthe→bleu ; progression linear-gradient(90deg,#2f7bff,#27ff93) bleu→menthe
- statuts (préfixes: "+ à voir" · "● en cours" · "✓ vu" (×N si revisionnages) · "✕ abandonné"): à voir jaune #ffd64a (bg rgba(255,214,74,.1), border .4) · en cours menthe · vu bleu #7eb0ff · abandonné rouge #ff5e5e (pas barré) — chips pill, bg .1 / border .4
- glow: 0 0 12-18px rgba(39,255,147,.35) ; halo de page: radial menthe 70%/-10% + radial bleu 15%/-10%
- placeholder affiche: repeating-linear-gradient(-45deg,#1a2032,#1a2032 6px,#151a29 6px,#151a29 12px), label mono #4d5468

## Typo
- Display/titres/logo: 'Chakra Petch' (600-700, logo letter-spacing 1px, OWLOG avec O menthe + text-shadow glow)
- Corps: 'IBM Plex Sans'
- Métadonnées/data/labels tab: 'JetBrains Mono' (9-11px, couleur muted)
- Titres de section: Chakra Petch 15px 600, préfixe "▸", MAJUSCULES, letter-spacing .5px

## Composants clés
- Recherche omniprésente : onglets "dossier" de type média AU-DESSUS de la barre (tout/films/séries/+), onglet actif fusionné à la barre (même fond #121724, border-bottom:none, margin-bottom:-1px, radius 10px 10px 0 0) ; barre radius 0 14px 14px 14px, border accent, placeholder « Ajouter ou rechercher dans {type}… »
- Cards: radius 14px, surface translucide + border
- Bouton play/action: 44px, radius 12px, dégradé + glow
- Tab bar bas: accueil / bibliothèque / stats / profil, labels mono 9px, icône active en dégradé
- Statuts: à voir (jaune) / en cours (menthe) / vu (bleu) / abandonné (rouge) + note étoiles menthe + progression (barre 4px dégradé 90deg bleu→menthe)
- Coup de cœur ♥: marqueur transversal, PAS un statut, cumulable avec tout statut. Toujours le dégradé menthe→bleu (seul élément non-action à y avoir droit). Affiche du média ♥: liseré dégradé 1px + glow léger (jamais sur la card conteneur, pas de badge). Rangée: ♥ glyphe dégradé à gauche de la pastille de statut. Page média: toggle ♥ 44px sans contour à droite de la note perso; notes externes (tmdb…) en mono à droite. Filtre: chip bordure+texte dégradé (jamais de fond plein)
- Revoir ↻: bouton plein dégradé 44px "↻ REVOIR" sur page média des titres vus — repasse en "● en cours" et ouvre un nouveau cycle dans le journal (— visionnage #N —); statut affiche "✓ vu ×N"
- Journal (page média): entrées mono datées border-left #212a3d, groupées par cycles de visionnage
- Hit targets mobiles ≥ 44px
- Desktop (≥1024px): tab bar → sidebar gauche 216px (logo, nav mono, user chip en bas), recherche omniprésente en tête de contenu (520px, raccourci ⌘K), contenu padding 40px; bibliothèque = liste en colonnes (TITRE/TYPE/PROGRESSION/NOTE/STATUT, en-têtes mono 9.5px #5f6474)

## Fichiers
- `Owlog Explorations.dc.html` — canvas d'itérations (turns 1-3 ; 3a = verrouillé)
- `Owlog Design System.dc.html` — référence du design system
- `Owlog Prototype.dc.html` — prototype interactif (landing → login → app ; statuts, notes, ♥, revoir, journal, recherche, stats calculées ; responsive sidebar/tab bar)
