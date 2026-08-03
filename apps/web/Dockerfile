# Image de owlog-web : la SPA construite, servie par Caddy.
#
# Construite depuis la RACINE du dépôt, pas depuis ce dossier : c'est un
# workspace pnpm, et le lockfile comme le package partagé vivent à la
# racine. Dokploy doit donc pointer son contexte de build sur la racine et
# ce fichier sur `apps/web/Dockerfile`.

# --- Étape de construction --------------------------------------------------
FROM node:22-alpine AS build

# Corepack fournit la version de pnpm épinglée dans package.json, plutôt
# qu'une version arbitraire décidée par l'image.
RUN corepack enable

WORKDIR /repo

# Les manifestes d'abord : tant qu'ils ne changent pas, Docker réutilise la
# couche d'installation, qui est de loin la plus lente.
# `.npmrc` fait partie des manifestes : sans lui, l'image installe sous des
# reglages differents de ceux du poste de developpement, et l'ecart ne se
# decouvre qu'au build du conteneur.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/

RUN pnpm install --frozen-lockfile --filter @owlog/web...

COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY apps/web apps/web

# Adresse de l'API et jeton partagé : ils sont injectés dans le bundle, donc
# publics par nature. Aucun secret ne passe ici — la clé TMDB ne quitte
# jamais owlog-api.
ARG VITE_API_URL
ARG VITE_SHARED_TOKEN
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SHARED_TOKEN=$VITE_SHARED_TOKEN

# L'image refuse de se construire sans ces deux arguments.
#
# Un `ARG` non fourni vaut la chaine vide, pas « absent » : le `??` du code
# ne le rattrape donc pas, et le bundle sort avec une base d'API vide. Il
# appelle alors `/search` au lieu de `/api/search`, Caddy repond `index.html`
# avec un `200`, et l'application echoue a lire du HTML comme du JSON. Tout
# marche jusqu'a la premiere frappe dans la barre de recherche.
#
# Une image est un artefact de production : mieux vaut ne pas la construire
# que la construire fausse et silencieuse.
RUN test -n "$VITE_API_URL" || { \
      echo "VITE_API_URL is required. Set it as a build argument (e.g. /api)." >&2; \
      exit 1; \
    }; \
    test -n "$VITE_SHARED_TOKEN" || { \
      echo "VITE_SHARED_TOKEN is required. Use the same value as OWLOG_SHARED_TOKEN." >&2; \
      exit 1; \
    }

RUN pnpm --filter @owlog/web build

# --- Image finale -----------------------------------------------------------
FROM caddy:2-alpine

COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/health || exit 1
