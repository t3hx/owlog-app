-- Schéma initial du temps 2 : comptes, journal d'événements, cache média,
-- jetons d'authentification, sessions.
--
-- Le serveur STOCKE des faits, il ne les interprète pas : aucune contrainte
-- CHECK sur les valeurs du domaine (types d'événements, précisions de date).
-- Deux appareils tourneront sur deux versions du client, et un serveur qui
-- refuserait un type d'événement qu'il ne connaît pas casserait l'appareil
-- le plus à jour. La validation sémantique vit dans le domaine, côté client.

CREATE TABLE users (
  id          uuid PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  first_name  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Le journal. Colonnes de StoredEvent + user_id + server_seq.
--
-- `server_seq` est le curseur de réplication : attribué par la base à
-- l'insertion, il donne un ordre total par lequel le pull pagine
-- (`WHERE server_seq > $curseur`). La contiguïté de sa visibilité est
-- garantie par le push (advisory lock transactionnel par utilisateur, F4),
-- pas par le schéma.
--
-- `device_id` est une colonne de l'événement lui-même, pas une colonne
-- ajoutée : la seule source est le champ que le client a écrit.
CREATE TABLE events (
  server_seq          bigserial PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users (id),
  id                  uuid NOT NULL,
  device_id           text NOT NULL,
  type                text NOT NULL,
  media_ref           text NOT NULL,
  cycle_key           text,
  created_at          timestamptz NOT NULL,
  occurred_at         timestamptz,
  occurred_precision  text NOT NULL,
  payload             jsonb,
  -- Un même événement poussé deux fois ne double pas : l'insertion du push
  -- fait ON CONFLICT (user_id, id) DO NOTHING et devient idempotente.
  UNIQUE (user_id, id)
);

CREATE INDEX events_user_seq ON events (user_id, server_seq);

-- Append-only en base aussi : rien n'est jamais muté ni supprimé, une
-- correction est un événement VOID. Le trigger transforme la règle projet
-- en garantie mécanique — un bug d'API ne peut pas réécrire l'histoire.
CREATE FUNCTION forbid_event_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only: % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION forbid_event_change();

-- Réplique serveur du cache média client. Jamais une source de statut :
-- un cache, upsert « dernière version gagne ».
--
-- `payload` est du jsonb et non des colonnes : la forme d'une ligne de
-- cache appartient au client (elle suivra les types de médias à venir), et
-- le serveur n'en lit aucun champ — il la stocke et la renvoie.
--
-- `updated_seq` est le curseur propre du cache (revue Eng) : le pull
-- incrémental ne renvoie que les lignes plus fraîches que le curseur, et
-- une mise à jour de cache sans événement se propage aussi.
CREATE SEQUENCE media_cache_seq;

CREATE TABLE media_cache (
  user_id      uuid NOT NULL REFERENCES users (id),
  ref          text NOT NULL,
  payload      jsonb NOT NULL,
  updated_seq  bigint NOT NULL DEFAULT nextval('media_cache_seq'),
  PRIMARY KEY (user_id, ref)
);

CREATE INDEX media_cache_user_seq ON media_cache (user_id, updated_seq);

-- Un e-mail de connexion émet DEUX secrets à usage unique — le lien et le
-- code — expirant ensemble (TTL 15 min) : sur PWA iOS installée, le lien
-- s'ouvre dans Safari dont le stockage est isolé, le code est la voie
-- nominale. Hachés au repos : un dump ne donne aucun accès.
--
-- `attempts` vit en base, pas en mémoire : un redémarrage du service ne
-- remet pas les essais de code à zéro.
CREATE TABLE auth_tokens (
  id           uuid PRIMARY KEY,
  email        text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz
);

CREATE INDEX auth_tokens_email ON auth_tokens (email);

-- Sessions à jeton haché au repos, 30 jours glissants, révocables.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id),
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

CREATE INDEX sessions_user ON sessions (user_id);
