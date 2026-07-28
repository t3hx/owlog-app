# Image de owlog-api : le proxy TMDB.
#
# Construite depuis la RACINE du dépôt, comme owlog-web : workspace pnpm,
# lockfile et package partagé à la racine.
#
# Pas d'étape de compilation. Node 22 exécute TypeScript directement via
# `--experimental-strip-types`, et le service n'utilise que des imports
# relatifs avec extension — précisément pour que ça marche sans outillage.
# Une étape de build ajouterait une pièce à opérer et une source de panne
# que je ne peux pas tester ici.

FROM node:22-alpine

RUN corepack enable

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/

# `--prod` : ni Vitest ni ESLint n'ont leur place dans une image qui tourne.
RUN pnpm install --frozen-lockfile --prod --filter @owlog/api...

COPY packages/contracts packages/contracts
COPY apps/api apps/api

WORKDIR /repo/apps/api

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# L'utilisateur `node` existe dans l'image officielle. Tourner en root
# n'apporte rien ici et coûte cher le jour où une dépendance déraille.
USER node

# La sonde suit le préfixe de montage : avec `OWLOG_BASE_PATH=/api`, le
# service ne répond plus à `/health`, et une sonde figée à la racine
# déclarerait le conteneur mort alors qu'il sert parfaitement. La forme
# shell est nécessaire ici — la forme exec n'interpole pas les variables.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:8787${OWLOG_BASE_PATH}/health" || exit 1

CMD ["node", "--experimental-strip-types", "src/server.ts"]
