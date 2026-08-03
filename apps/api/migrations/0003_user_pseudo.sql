-- Identité sociale : le pseudo (T3H-63).
--
-- Le produit n'avait qu'un prénom, et il est privé. Le pseudo est l'identité
-- publique : c'est de lui que sort l'initiale de l'avatar, et lui seul qui
-- circule entre comptes.
--
-- **Nullable, et c'est la règle produit.** Le pseudo se crée au premier geste
-- social, pas à l'inscription : un compte sync sans pseudo reste pleinement
-- utilisable. Postgres autorise autant de NULL qu'on veut sous un index
-- unique, donc l'unicité et l'optionalité cohabitent sans colonne de plus.
ALTER TABLE users ADD COLUMN pseudo text;

-- Le format vit ici EN PLUS de Zod, pas à la place.
--
-- Zod refuse une saisie ; cette contrainte refuse une écriture, d'où qu'elle
-- vienne — migration de données, correction à la main en production, futur
-- import. Les deux disent la même chose, et c'est voulu : la validation
-- d'entrée protège l'utilisateur, la contrainte protège la table.
--
-- Les minuscules sont forcées à la saisie, donc interdites en base : un
-- index unique ordinaire suffit, sans `citext` ni index fonctionnel. C'est
-- la contrainte de format qui rend le problème de casse inexistant plutôt
-- qu'un mécanisme de comparaison qui le gère.
ALTER TABLE users
  ADD CONSTRAINT users_pseudo_format
  CHECK (pseudo IS NULL OR pseudo ~ '^[a-z0-9_]{3,20}$');

-- L'unicité se **constate** à l'écriture, elle ne se vérifie pas avant.
--
-- Un `SELECT` puis un `INSERT` est un time-of-check/time-of-use : deux
-- comptes qui réservent le même pseudo à la même seconde passeraient tous
-- deux le contrôle. La route attrape la violation 23505 et rend
-- `{ error, code: "pseudo_taken" }` ; c'est la base qui arbitre, pas
-- l'application.
CREATE UNIQUE INDEX users_pseudo_key ON users (pseudo);
