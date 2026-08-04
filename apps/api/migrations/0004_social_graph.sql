-- Le graphe social : amitiés, demandes, et le compteur qui protège
-- l'annuaire (T3H-62).
--
-- Trois tables, trois rôles distincts : une relation symétrique et
-- définitive, une intention orientée et périssable, une trace qui sert de
-- compteur. Les confondre — par exemple stocker la demande acceptée comme
-- une amitié « à l'état accepté » — obligerait chaque lecture d'amitié à
-- connaître le vocabulaire des demandes.

-- L'amitié, en couple NORMALISÉ.
--
-- La relation est symétrique : « alpha est ami avec beta » et l'inverse
-- sont le même fait, et un fait ne se stocke qu'une fois. Deux lignes
-- miroir auraient laissé la porte ouverte à la seule incohérence qui
-- compte ici — une moitié d'amitié, où l'un voit l'autre sans réciproque.
--
-- La normalisation est portée par la CONTRAINTE, pas par la discipline de
-- l'application : `user_a < user_b` rend l'écriture miroir impossible, donc
-- la clé primaire suffit à garantir l'unicité symétrique. Une écriture qui
-- oublierait de trier échoue bruyamment au lieu de dupliquer.
CREATE TABLE friendships (
  user_a      uuid NOT NULL REFERENCES users (id),
  user_b      uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CONSTRAINT friendships_normalized CHECK (user_a < user_b)
);

-- La clé primaire indexe `(user_a, user_b)` : les lectures par `user_b`
-- seul — « qui sont mes amis ? », posée depuis les deux côtés du couple —
-- n'en profiteraient pas.
CREATE INDEX friendships_user_b ON friendships (user_b);

-- La demande : orientée, et résolue une seule fois.
--
-- `resolution` garde le verdict après coup (`accepted` / `declined`). Il
-- n'est jamais lu par une route : le refus est SILENCIEUX côté demandeur
-- (`social.md` §1), donc rien ne l'affiche. Il existe pour l'exploitation —
-- comprendre un incident, mesurer un abus — et parce qu'effacer la ligne
-- rendrait un second envoi indiscernable d'un premier.
CREATE TABLE friend_requests (
  id            uuid PRIMARY KEY,
  requester_id  uuid NOT NULL REFERENCES users (id),
  addressee_id  uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolution    text,
  CONSTRAINT friend_requests_not_self CHECK (requester_id <> addressee_id),
  -- Résolue et sans verdict, ou pendante avec un verdict : deux états qui
  -- n'ont aucun sens. La contrainte les rend inatteignables.
  CONSTRAINT friend_requests_resolution CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

-- Une seule demande PENDANTE par couple orienté — index unique PARTIEL.
--
-- L'unicité ne peut pas porter sur `(requester_id, addressee_id)` tout
-- court : après un refus, redemander doit rester possible. Le taire serait
-- une notification de rejet déguisée — le demandeur apprendrait par
-- l'échec ce que le silence lui cache.
CREATE UNIQUE INDEX friend_requests_pending
  ON friend_requests (requester_id, addressee_id)
  WHERE resolved_at IS NULL;

-- La boîte de réception : `▸ DEMANDES · N` la lit à chaque ouverture de
-- l'écran Amis. Partiel aussi — les demandes résolues n'y sont jamais.
CREATE INDEX friend_requests_inbox
  ON friend_requests (addressee_id)
  WHERE resolved_at IS NULL;

-- Journal des gestes sociaux, et compteur anti-énumération de la recherche
-- de pseudo.
--
-- **Table distincte d'`auth_audit`, à dessein.** Le motif est le même — un
-- compteur en base plutôt qu'en mémoire, pour qu'un redémarrage ne rende
-- pas sa fenêtre à qui balayait l'annuaire — mais la clé de comptage n'est
-- pas la même : `auth_audit` compte par e-mail et par IP, la recherche
-- compte par COMPTE APPELANT (elle exige une session). Les index d'
-- `auth_audit` ne servent pas cette question, et y verser des lignes non
-- authentiques rendrait son nom faux.
--
-- Ce qui NE s'écrit pas ici : le pseudo cherché quand il n'existe pas est
-- gardé (`target`) car il est déjà connu de l'appelant, mais aucune trace
-- ne relie deux comptes qui ne se sont pas trouvés.
CREATE TABLE social_audit (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL,
  actor_id    uuid NOT NULL REFERENCES users (id),
  target      text,
  result      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX social_audit_actor_window ON social_audit (kind, actor_id, created_at);
