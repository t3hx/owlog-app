# TODOS

Travail considéré et explicitement différé. Chaque entrée porte son
contexte : un TODO sans contexte est pire que pas de TODO. Origine :
revue /autoplan du sprint temps 2 (2026-07-30, plan dans
`~/.gstack/projects/t3hx-owlog-app/tehx-dev-sprint-temps2-plan-20260730.md`).

## Suppression de compte + purge serveur — P2, M

- **Quoi** : endpoint et parcours Réglages pour effacer un compte et ses
  événements côté serveur.
- **Pourquoi différé** : première opération destructive d'un système
  append-only strict ; l'interaction avec les curseurs des autres appareils
  n'est pas triviale (tombstone ? réinitialisation des curseurs ?) et la
  valeur est nulle tant que la base compte un utilisateur.
- **Par où commencer** : spécifier la sémantique (tombstone vs reset) avant
  toute ligne de code ; le client doit détecter « compte disparu » proprement.
- **Bloqué par** : rien ; à faire avant d'ouvrir des comptes à d'autres
  personnes (temps 3).

## Canal temps réel (SSE ou WebSocket) — P3, L

- **Quoi** : push serveur→client pour remplacer les déclencheurs discrets.
- **Pourquoi différé** : le critère de fraîcheur du sprint (« à jour au
  retour au premier plan ») est satisfait sans lui.
- **Par où commencer** : le curseur `server_seq` rend le canal additif —
  l'événement SSE ne porte que « du nouveau existe », le client fait son
  pull normal. Aucun retravail du protocole.

## Providers OAuth de l'écran 2 (Google / Apple / Discord) — P3, M

- **Quoi** : boutons de connexion tiers du prototype Connexion.
- **Pourquoi différé** : consoles développeur, redirect URIs et validation
  Apple forment un chantier propre ; le lien magique + code couvre le
  besoin. Les boutons sont **masqués** en attendant (décision design n°2).
- **Par où commencer** : Google d'abord (console la plus simple), flux
  code PKCE côté `owlog-api`.

## Liste des appareils connectés + révocation — P3, M

- **Quoi** : rangée « appareils » dans Réglages, listant les sessions
  actives avec révocation.
- **Pourquoi différé** : la table `sessions` révocable existe côté serveur
  dès ce sprint ; seule l'UI manque, et elle ne sert que le multi-appareils
  avancé. (Décision par défaut du gate /autoplan : différer.)
- **Par où commencer** : `GET /auth/sessions` + rangées dans `▸ COMPTE`.

## Capture réelle du hero Landing desktop — P3, S

- **Quoi** : remplacer le placeholder hachuré du hero par une capture de
  l'app sur un jeu de données de démonstration défini.
- **Pourquoi différé** : les visuels TMDB ne se versionnent pas ; un
  placeholder honnête vaut mieux qu'une capture vide ou mensongère.

## Chiffrement de bout en bout des événements — consigné, non planifié

Contradictoire avec les lectures sociales du temps 3 (les amis lisent des
projections des journaux). À re-décider uniquement si le besoin naît d'un
usage réel. Pas un TODO actionnable aujourd'hui.
