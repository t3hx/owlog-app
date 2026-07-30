-- Auth par lien magique + code court (F3).
--
-- Les deux secrets d'un même e-mail — le lien et le code — sont à usage
-- unique CHACUN, pas ensemble : sur PWA iOS installée, le lien s'ouvre
-- dans Safari (stockage isolé) et y crée sa session ; le code doit rester
-- consommable depuis la PWA. La colonne unique `consumed_at` de 0001
-- devient donc deux marques indépendantes.
ALTER TABLE auth_tokens RENAME COLUMN consumed_at TO token_consumed_at;
ALTER TABLE auth_tokens ADD COLUMN code_consumed_at timestamptz;

-- Journal d'audit des tentatives d'authentification.
--
-- Deux rôles : la trace (qui a essayé quoi, d'où, avec quel résultat) et
-- le rate-limit PERSISTANT de request-link — compté par fenêtre SQL sur
-- ces lignes, par IP et par adresse destinataire. En base et pas en
-- mémoire : un redémarrage du service ne remet pas les compteurs à zéro.
CREATE TABLE auth_audit (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL,
  email       text,
  ip          text,
  result      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_audit_email_window ON auth_audit (kind, email, created_at);
CREATE INDEX auth_audit_ip_window ON auth_audit (kind, ip, created_at);
