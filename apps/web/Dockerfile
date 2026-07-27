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
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/

RUN pnpm install --frozen-lockfile --filter @owlog/web...

COPY packages/contracts packages/contracts
COPY apps/web apps/web

# Adresse de l'API et jeton partagé : ils sont injectés dans le bundle, donc
# publics par nature. Aucun secret ne passe ici — la clé TMDB ne quitte
# jamais owlog-api.
ARG VITE_API_URL
ARG VITE_SHARED_TOKEN
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SHARED_TOKEN=$VITE_SHARED_TOKEN

RUN pnpm --filter @owlog/web build

# --- Image finale -----------------------------------------------------------
FROM caddy:2-alpine

COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/health || exit 1
