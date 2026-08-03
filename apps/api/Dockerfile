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

# --- CLI Doppler ------------------------------------------------------------
#
# Le service lit ses secrets chez Doppler au démarrage plutôt que de les
# recevoir de l'orchestrateur. Ce qui vit dans Dokploy n'est donc plus le
# jeton TMDB ni l'URL Postgres, mais un unique jeton de service : scopé à la
# config `prd`, en lecture seule, révocable d'une commande. Une fuite de la
# base Dokploy coûte alors une révocation, et non une rotation chez TMDB,
# Postgres et Resend.
#
# La version est épinglée et l'empreinte vérifiée, là où la méthode promue
# par Doppler (`curl -Ls https://cli.doppler.com/install.sh | sh`) tire la
# dernière version disponible au moment du build : deux images construites à
# un mois d'écart n'embarqueraient pas le même binaire, et un script distant
# exécuté sans contrôle est une porte d'entrée dans l'image — ce qu'on ne
# s'autorise pas dans un changement motivé par la sécurité.
#
# L'architecture vient de `uname -m` et non de l'`ARG TARGETARCH` de Docker :
# `TARGETARCH` n'est renseigné que sous BuildKit, or `scripts/local-prod.sh`
# appelle `docker build` sans rien imposer. Vide, l'ARG demanderait une
# archive inexistante. `uname -m` s'exécute dans l'environnement cible et
# répond juste quel que soit le constructeur — ce qui compte, l'image étant
# bâtie en arm64 sur un poste Apple et en amd64 sur un runner.
ARG DOPPLER_VERSION=3.76.1
RUN set -eux; \
    case "$(uname -m)" in \
      x86_64) arch=amd64 ;; \
      aarch64) arch=arm64 ;; \
      *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    archive="doppler_${DOPPLER_VERSION}_linux_${arch}.tar.gz"; \
    base="https://github.com/DopplerHQ/cli/releases/download/${DOPPLER_VERSION}"; \
    cd /tmp; \
    wget -q "${base}/${archive}"; \
    wget -q -O checksums.txt "${base}/checksums.txt"; \
    grep " ${archive}\$" checksums.txt | sha256sum -c -; \
    tar xzf "${archive}" doppler; \
    mv doppler /usr/local/bin/doppler; \
    rm -f "${archive}" checksums.txt; \
    doppler --version

WORKDIR /repo

# `.npmrc` fait partie des manifestes : sans lui, l'image installe sous des
# reglages differents de ceux du poste de developpement, et l'ecart ne se
# decouvre qu'au build du conteneur.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/

# `--prod` : ni Vitest ni ESLint n'ont leur place dans une image qui tourne.
RUN pnpm install --frozen-lockfile --prod --filter @owlog/api...

COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY apps/api apps/api

WORKDIR /repo/apps/api

RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8787

# Le préfixe de montage appartient à l'IMAGE, pas au coffre à secrets.
#
# Ce n'en est pas un : c'est la topologie de montage du service, identique
# pour tout conteneur bâti sur cette image. Et surtout, la sonde ci-dessous
# doit pouvoir le lire — or elle s'exécute dans un processus séparé, qui ne
# passe pas par `doppler run` et ne voit donc AUCUNE variable injectée par
# Doppler. Laisser ce préfixe dans Doppler donnerait une sonde qui interroge
# `/health` pendant que le service écoute sur `/api/health` : le conteneur
# serait déclaré mort en servant parfaitement, et Dokploy le ferait revenir
# en arrière tout seul.
ENV OWLOG_BASE_PATH=/api

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

# L'entrée choisit entre `doppler run -- node` et `node` seul selon la
# présence de DOPPLER_TOKEN. Voir docker-entrypoint.sh pour le pourquoi des
# deux modes.
ENTRYPOINT ["./docker-entrypoint.sh"]
