# Flux de rétro-datage — spécification d'écran

Écran hors handoff, étape 7. Le document de design impose une session de design avant la session de code ; ceci en est le rendu. Prototype : `Owlog Retro-datage.dc.html`, à ouvrir tel quel.

Le système de design ne bouge pas : tokens, typo et composants sont ceux du handoff. Rien ici ne rediscute le verrou.

## Ce que l'écran doit réussir

**Vingt titres en une soirée sans pénibilité.** C'est la contrainte qui commande tout le reste. L'ennemi n'est pas la densité de l'écran, c'est le nombre de gestes par titre — et le geste le plus coûteux est la date.

## Trois décisions, et pourquoi

**Un mode de saisie, pas une seconde action par rangée.** La recherche porte un interrupteur : `+ ajouter en « à voir »` / `✓ logger un souvenir`. En mode souvenir, le `+` de chaque rangée devient `✓` et ouvre la feuille. Deux boutons par rangée serraient la mise en page dès qu'un titre est long, et le mode tient sur les vingt titres d'une session — c'est exactement la forme de l'usage. Le mode est teinté en bleu « vu », visible en permanence, et se réinitialise à chaque ouverture de l'app : un mode invisible est un mode qui produit des erreurs.

**Une feuille par-dessus la recherche, jamais un écran.** Une route dédiée perdrait la requête et la liste à chaque validation ; il faudrait retaper. La feuille laisse la liste derrière elle, et la fermer rend la main exactement où on était.

**L'année par défaut.** En loguant une mémothèque, le cas dominant est « vers 2019 », pas « le 14 juin à 21 h ». Une rangée d'années récentes met le cas dominant à un tap. `date exacte` et `je ne sais plus` sont deux échappatoires à côté, jamais un choix préalable — un sélecteur de précision d'abord ferait deux décisions par titre au lieu d'une.

## Composition

**Feuille de saisie**

| Bloc | Contenu | Règle |
|---|---|---|
| Poignée + en-tête | affiche 40×60, titre Chakra Petch 16px, méta mono 9.5px | fermer = abandonner, rien n'est écrit |
| `QUAND ?` | années récentes en chips 12px mono, une active en menthe | défaut : aucune sélection, l'année courante en tête |
| Échappatoires | `← plus tôt` · `date exacte` · `je ne sais plus` | chips pill, mono 10px |
| `TON AVIS — OPTIONNEL` | 5 étoiles menthe, re-tap efface | même règle que la page média |
| Commentaire | replié derrière `+ ajouter un commentaire` | il appelle le clavier, donc il coûte cher : jamais ouvert par défaut |
| Action | `ENREGISTRER CE VISIONNAGE`, 48px plein dégradé + glow | |
| Note de bas | rappelle la précision retenue et ce que le journal affichera | |

**Confirmation — le bloc qui compte**

`backdate` soit rattache le `SEEN` à un cycle ouvert, soit minte un cycle neuf. **La feuille doit dire lequel.** Sans ça l'utilisateur ne peut pas faire confiance à la règle, et le critère d'acceptation de l'étape est littéralement « fini la semaine dernière clôt sans dupliquer ».

- rattachement → `✓ visionnage #N clos` + « un visionnage était ouvert et antérieur à {date} : il a été clos, pas dupliqué. »
- cycle neuf → `✓ visionnage #N enregistré`

Puis deux suites, et un compteur de session :

- `↻ encore un visionnage` — garde le titre, remet la date à zéro. C'est l'enchaînement demandé par le plan pour un titre revu plusieurs fois.
- `titre suivant →` — ferme la feuille, vide la requête, rend le focus à la recherche.
- `N titres logués ce soir` — donne le rythme de la session, mono 9.5px subtle.

## Précisions et domaine

L'écran n'expose que trois des cinq précisions de `DatePrecision`, conformément au plan :

| Geste | `occurred_at` | `occurred_precision` |
|---|---|---|
| chip d'année | 1er janvier de l'année, à midi UTC | `year` |
| `date exacte` | la date saisie | `day` |
| `je ne sais plus` | `null` | `unknown` |

`month` et `exact` ne sont produits par aucun geste au temps 1. Ils restent dans le type parce que le store est append-only et qu'un import les produira.

Aucune règle métier ne vit dans cet écran : il appelle `backdate`, déjà écrit et testé.
