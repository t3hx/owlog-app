# Runbook — VPS netcup → Dokploy sécurisé (set-and-forget)

**Cible :** netcup RS 8 Go / 4 vCPU / 256 Go — Debian 13 (Trixie) — Dokploy + Traefik — Cloudflare Tunnel pour `*.nspace.link` — Tailscale pour l'admin.

**Modèle de sécurité en une phrase :** la firewall netcup (niveau réseau, en amont de Docker) est le périmètre réel ; UFW est une deuxième couche pour ce qui ne passe pas par Docker ; aucun port web n'est ouvert en entrée, le trafic public arrive *par l'intérieur* via le tunnel Cloudflare.

---

## Phase 0 — Avant de reformater

- [ ] Sauvegarder ce qui doit l'être (volumes Docker, `/etc/dokploy`, dumps DB).
- [ ] **Activer la 2FA sur le SCP netcup.** Le SCP devient ton plan de contrôle firewall — s'il tombe, tout tombe. netcup l'impose depuis le 10 août 2026 de toute façon.
- [ ] Vérifier que tu as accès à la **console VNC** dans le SCP (c'est ton filet de sécurité si tu te verrouilles dehors) et au **système de rescue**.
- [ ] Avoir sous la main : clé SSH publique, compte Cloudflare avec `nspace.link`, compte Tailscale.

---

## Phase 1 — Installation OS + durcissement de base

### 1.1 Image

SCP → serveur → **Media** → installer **Debian 13 (minimal / sans interface graphique)**.
Ne prends pas d'image « avec panel » (Plesk, cPanel…) : services en plus, surface en plus.

### 1.2 Premier login et mises à jour

```bash
ssh root@<IP_PUBLIQUE>
apt update && apt full-upgrade -y
apt install -y curl ca-certificates ufw fail2ban unattended-upgrades zram-tools
```

### 1.3 Utilisateur non-root

```bash
adduser thibault
usermod -aG sudo thibault
mkdir -p /home/thibault/.ssh
# colle ta clé publique
nano /home/thibault/.ssh/authorized_keys
chmod 700 /home/thibault/.ssh
chmod 600 /home/thibault/.ssh/authorized_keys
chown -R thibault:thibault /home/thibault/.ssh
```

Ouvre **un second terminal** et vérifie `ssh thibault@<IP>` **avant** de continuer.

### 1.4 Durcissement SSH

```bash
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
X11Forwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers thibault
EOF

sshd -t && systemctl restart ssh
```

> On laisse sshd écouter sur `0.0.0.0`. Le blocage se fera au niveau firewall, pas par `ListenAddress` — sinon au boot sshd démarre avant que `tailscale0` existe et le service échoue.

### 1.5 Mémoire : zram + swapfile de secours

```bash
# zram (compression en RAM, priorité haute)
cat > /etc/default/zramswap <<'EOF'
ALGO=zstd
PERCENT=50
PRIORITY=100
EOF
systemctl restart zramswap

# swapfile disque, priorité basse = filet uniquement
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw,pri=-2 0 0' >> /etc/fstab

# on privilégie zram avant le disque
echo 'vm.swappiness=180'            >  /etc/sysctl.d/99-zram.conf
echo 'vm.watermark_boost_factor=0'  >> /etc/sysctl.d/99-zram.conf
echo 'vm.watermark_scale_factor=125'>> /etc/sysctl.d/99-zram.conf
echo 'vm.page-cluster=0'            >> /etc/sysctl.d/99-zram.conf
sysctl --system

swapon --show   # vérifie : zram prio 100, /swapfile prio -2
```

### 1.6 Mises à jour automatiques

```bash
dpkg-reconfigure -plow unattended-upgrades   # répondre Oui

cat > /etc/apt/apt.conf.d/51-custom <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
```

Docker Swarm et Dokploy redémarrent proprement (`restart: always`), le reboot auto est sans danger ici.

### 1.7 fail2ban

Sur Debian 13, fail2ban utilise le journal systemd et nftables par défaut (`rsyslog` n'est plus installé, donc pas de `/var/log/auth.log`). Le piège classique — jail qui ne trouve pas de log — n'existe plus si tu poses explicitement le backend :

```bash
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
backend    = systemd
bantime    = 1h
findtime   = 10m
maxretry   = 5
allowipv6  = auto
ignoreip   = 127.0.0.1/8 ::1 100.64.0.0/10

[sshd]
enabled = true
EOF

systemctl enable --now fail2ban
fail2ban-client status sshd
```

> **Honnêteté :** une fois la Phase 3 terminée, SSH n'est plus joignable publiquement et fail2ban ne bannira plus rien. Ça reste utile pendant la phase de transition et si tu rouvres un jour un port. Ce n'est pas ta couche porteuse.

---

## Phase 2 — Tailscale (à faire AVANT de fermer SSH)

### 2.1 Installation

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh --accept-dns=false
```

- `--ssh` : active Tailscale SSH (auth par le tailnet, pas de clé à gérer). Tu gardes sshd classique en secours.
- `--accept-dns=false` : évite que Tailscale réécrive `/etc/resolv.conf` du serveur. Le MagicDNS côté clients fonctionne quand même.

Les routes du réseau Docker seront ajoutées en Phase 4 (le réseau n'existe pas encore).

### 2.2 Récupérer l'IP tailnet

```bash
tailscale ip -4      # -> 100.x.y.z
tailscale status
```

### 2.3 Console d'admin Tailscale — 2 réglages critiques

1. **Machines → ton serveur → Disable key expiry.** Sans ça, la clé expire (180 j par défaut) et tu perds tout accès un matin. C'est *la* chose qui casse un set-and-forget.
2. **DNS → activer MagicDNS** (tu auras `serveur.tailXXXX.ts.net`).

### 2.4 Test bloquant

Depuis ton laptop (Tailscale installé et connecté) :

```bash
ssh thibault@100.x.y.z
# et
ssh thibault@serveur.tailXXXX.ts.net
```

**Si ça ne marche pas, n'avance pas.** C'est ta seule porte après la Phase 3.

---

## Phase 3 — Verrouillage réseau

### 3.1 Firewall netcup (le périmètre réel)

SCP → serveur → **Options → Firewall Policies → Add Firewall Policy** (nom : `dokploy-lockdown`), puis **Add Rule** pour chaque ligne.

**Deux règles du jeu à retenir :**
- Dès qu'**une seule** règle INGRESS existe, la règle implicite INGRESS bascule de `ACCEPT ANY` à `DROP`. Idem côté EGRESS.
- La firewall est **stateful en TCP uniquement**. Pour l'UDP il faut autoriser explicitement le trafic retour.

**On ne crée AUCUNE règle EGRESS** → le sortant reste `ACCEPT ANY` (c'est aussi la recommandation de netcup).

| # | Type | Proto | Ports source | Ports dest. | Action | Pourquoi |
|---|---------|------|--------------|-------------|--------|----------|
| 1 | INGRESS | TCP | any | `22` | ACCEPT | **TEMPORAIRE** — à supprimer en 3.4 |
| 2 | INGRESS | UDP | any | `41641` | ACCEPT | Tailscale WireGuard direct (sinon relais DERP = lent) |
| 3 | INGRESS | UDP | `7844` | any | ACCEPT | Réponses QUIC du tunnel Cloudflare |
| 4 | INGRESS | UDP | `123` | any | ACCEPT | Réponses NTP (sinon dérive d'horloge → TLS cassé) |
| 5 | INGRESS | UDP | `53` | any | ACCEPT | Réponses DNS (si tu utilises un résolveur hors netcup) |
| 6 | INGRESS | UDP | `67` | `68` | ACCEPT | DHCP — utile seulement si l'image netcup l'utilise |
| 7 | INGRESS | ICMP | — | — | ACCEPT | Path MTU discovery + ping de diagnostic |

**Aucune règle pour 80, 443, 3000.** C'est tout l'intérêt : le trafic web entre par le tunnel, qui est une connexion *sortante*.

Puis : serveur → **Firewall → Edit Policies** → déplacer `dokploy-lockdown` à droite → **Edit** → **Save**.

Supprime aussi la policy `netcup Mail block` seulement si tu comptes envoyer du SMTP (sinon laisse-la, elle te protège).

> Note : les connexions déjà établies ne sont pas réévaluées après un changement de règle. Ta session SSH courante survivra — ne t'en sers pas comme preuve que ça marche.

### 3.2 UFW (deuxième couche, côté hôte)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw allow 22/tcp comment 'temporaire'
ufw --force enable
ufw status verbose
```

> **Rappel important :** UFW écrit dans la chaîne `INPUT`, or les paquets vers un port publié par Docker sont DNAT'és en `PREROUTING` puis traversent `FORWARD` — ils ne voient jamais `INPUT`. Donc UFW **ne protège pas** les ports Docker (80/443/3000). C'est exactement pour ça que la firewall netcup est la couche porteuse. Ne compte jamais sur `ufw status` pour savoir ce qui est exposé.

### 3.3 Vérification depuis l'extérieur

Depuis une machine **hors tailnet** :

```bash
nmap -Pn -p 22,80,443,3000 <IP_PUBLIQUE>
```

Attendu à ce stade : seul `22` en `open`, le reste `filtered`.

### 3.4 Fermeture finale de SSH public

> À faire **seulement** quand Tailscale SSH est validé (2.4). Filet de secours : console VNC du SCP.

```bash
ufw delete allow 22/tcp
```

Puis SCP → supprime la **règle n°1** de la policy → Save.

Re-scan : tout doit être `filtered`.

---

## Phase 4 — Dokploy

### 4.1 Installation

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Le script installe Docker s'il manque, initialise Swarm, crée `dokploy-network`, lance `dokploy-traefik` (conteneur standalone, ports 80/tcp, 443/tcp, 443/udp) et le service Swarm `dokploy` (port 3000).

Ces ports sont publiés sur `0.0.0.0` par Docker — **c'est sans conséquence** : la firewall netcup les drop en amont. Tu les atteins via ton IP tailnet.

### 4.2 Rotation des logs Docker (anti-saturation disque)

```bash
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
```

### 4.3 Premier accès

```
http://100.x.y.z:3000
```
ou `http://serveur.tailXXXX.ts.net:3000`

Crée le compte admin **immédiatement** (la page de setup est ouverte à quiconque peut l'atteindre — ici, seulement ton tailnet).

Puis dans Dokploy : **Settings → Profile → activer la 2FA**.

### 4.4 Publier la route du réseau Docker sur le tailnet

```bash
docker network inspect dokploy-network | grep Subnet
# ex. "Subnet": "10.254.0.0/24"

tailscale set --advertise-routes=10.254.0.0/24
```

Puis console Tailscale → Machines → ton serveur → **approuver la route**.

Tu peux dès lors joindre n'importe quel conteneur par son IP interne depuis le tailnet — pratique pour debug, et indispensable si un jour tu veux exposer un service sans passer par Traefik.

### 4.5 Nettoyage automatique

Dokploy → **Settings → Server → Docker Cleanup** : active le nettoyage périodique (images dangling, build cache). Sur 256 Go tu as de la marge, mais autant ne jamais y penser.

---

## Phase 5 — Cloudflare Tunnel

### 5.1 Créer le tunnel

Dashboard Cloudflare → **Zero Trust → Networks → Connectors → Create a tunnel** → type **Cloudflared** → nom `nspace-tunnel` → **copier le Tunnel Token**.

### 5.2 Réglages de zone : SSL/TLS et cache

**SSL/TLS → Overview** → mode **Full**.

⚠️ Jamais **Flexible** : ça crée des boucles de redirection avec Traefik.
Active aussi **Edge Certificates → Always Use HTTPS**.

**Caching → Configuration → Browser Cache TTL** → **Respect Existing Headers**.

> ⚠️ **Le piège du Browser Cache TTL.** Les zones anciennes ont pour défaut
> **4 heures**, et ce réglage **écrase** le `Cache-Control` renvoyé au
> navigateur — un `no-cache` de l'origine compte comme zéro et perd
> systématiquement. Le piège est sélectif, donc trompeur : Cloudflare ne
> cache en edge que certaines extensions (`.js`, `.css`, images…), et seuls
> ces fichiers sont réécrits. Constaté sur owlog : `index.html` et
> `manifest.webmanifest` gardaient leur `no-cache`, mais `sw.js` — le seul
> fichier dont la fraîcheur porte les mises à jour PWA — sortait en
> `max-age=14400`.
>
> **Indétectable en local** : `local-prod.sh check` interroge le Caddy
> frontal, jamais l'edge Cloudflare. Un déploiement peut donc passer tous
> les contrôles locaux et servir des en-têtes faux en production. Après
> tout changement d'en-têtes, vérifier **à travers** Cloudflare :
>
> ```bash
> curl -sD - -o /dev/null https://owlog.nspace.link/sw.js | grep -i cache-control
> # attendu : no-cache — un max-age=14400 signale le réglage de zone resté à 4 h
> ```
>
> Pas de purge nécessaire après correction : Cloudflare rafraîchit les
> en-têtes stockés à la revalidation suivante. Et si un service de la zone
> comptait sur le TTL implicite, la bonne réponse est de déclarer ses
> en-têtes à *son* origine, pas de revenir au TTL global.

### 5.3 Déployer cloudflared dans Dokploy — méthode Compose

> **Pourquoi pas la méthode de la doc officielle ?** La page « Cloudflare Tunnels » de Dokploy décrit un onglet *Advanced* avec un champ *Arguments* qui n'existe plus (la doc de référence de l'onglet Advanced ne le liste pas), et un onglet *Environments* qui s'appelle aujourd'hui *Environment*. Elle date d'avant l'ajout de la couche Environnements. On passe donc par un service **Compose**, dont le format ne bouge pas.

**Hiérarchie actuelle de l'UI :** Organisation → **Projet** → **Environnement** → **Service**.
Un nouveau projet crée automatiquement un environnement `Production`. Les services se créent *à l'intérieur* de cet environnement.

**Étapes :**

1. Dashboard → **Projects** → **Create Project** → nom `infra`
2. Entrer dans le projet → l'environnement **Production** est sélectionné par défaut
3. **Create Service** → **Compose**
4. Onglet **General** :
   - Compose Type : **Docker Compose** (pas *Stack*)
   - Provider / Source Type : **Raw**
   - Coller dans l'éditeur :

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}
    networks:
      - dokploy-network

networks:
  dokploy-network:
    external: true
```

5. Onglet **Environment** → ajouter :

```
TUNNEL_TOKEN=<ton-token-cloudflare>
```

6. **Deploy**

**Piège à connaître :** les variables définies dans l'onglet Environment sont écrites dans un fichier `.env` mais **ne sont pas injectées automatiquement** dans les conteneurs. C'est exactement pour ça que le compose ci-dessus utilise la substitution `${TUNNEL_TOKEN}`. Si tu retires cette ligne en pensant que la variable suffit, le conteneur démarre sans token et boucle en erreur d'authentification.

**Notes sur le compose :**

- `networks: dokploy-network / external: true` est la ligne indispensable : sans elle, cloudflared ne peut pas résoudre `dokploy-traefik`. Le réseau est un overlay *attachable* créé par Dokploy, un service compose classique peut donc s'y rattacher.
- `--no-autoupdate` : cloudflared essaie sinon de se mettre à jour tout seul en cours d'exécution. Dans un conteneur, on veut que la version vienne de l'image, pas d'un binaire réécrit à chaud.
- `latest` est acceptable pour démarrer ; une fois que ça tourne, épingle la version affichée dans les logs (format `2026.x.y`) pour éviter une régression silencieuse au prochain redéploiement.

**Vérification :**

Onglet **Logs** du service, ou depuis le serveur :

```bash
docker ps --filter name=cloudflared
docker logs -f $(docker ps -q --filter name=cloudflared)
```

Tu dois voir **4 connexions établies** vers des IP de l'edge Cloudflare (`Registered tunnel connection` × 4). Moins de 4 = tunnel dégradé, tu auras des erreurs 530 intermittentes.

Contrôle que la résolution interne fonctionne :

```bash
docker run --rm --network dokploy-network curlimages/curl -sI http://dokploy-traefik:80
```

Une réponse HTTP (même 404) prouve que le chemin cloudflared → Traefik est bon. Un `Could not resolve host` signifie que le bloc `networks` a été oublié.

> **Si le tunnel ne monte pas en QUIC** (règle netcup UDP 7844 mal posée), remplace le `command` par `tunnel --no-autoupdate --protocol http2 run`. Il bascule sur TCP/7844, couvert par le suivi de connexion TCP de netcup. Un peu moins performant, mais robuste.

> **Variante sans Dokploy.** Si tu préfères que le tunnel ne dépende pas de l'orchestrateur qu'il dessert — argument défendable : si Dokploy casse, tu perds aussi ton accès public — installe `cloudflared` en service systemd sur l'hôte et pointe les routes vers `http://127.0.0.1:80`. Ça marche parce que Traefik publie bien 80 sur l'hôte (§4.1). Tu perds la visibilité dans l'UI Dokploy, tu gagnes en indépendance.

### 5.4 ⚠️ Le piège du wildcard

La doc Dokploy propose un CNAME `*` + une published route `*` → `dokploy-traefik:80`. **Ne fais pas ça dans ton cas.**

Avec un wildcard, *tout* sous-domaine devient public dès que Traefik connaît la route — y compris `beszel.nspace.link` ou `adminer.nspace.link` que tu voulais garder privés. Un oubli de config Dokploy = fuite immédiate.

**Fais du déclaratif, une route par app publique.** C'est 30 secondes de plus par déploiement et ça rend l'exposition explicite et auditable.

### 5.5 Publier une app

> ⚠️ **Le piège le plus probable.** La quasi-totalité des tutos Dokploy (et la plupart des assistants IA) te diront de créer un enregistrement **A vers l'IP publique du serveur, nuage orange**. C'est le montage Dokploy standard, et il est **incompatible avec cette architecture** : nos ports 80/443 n'ont aucune règle INGRESS chez netcup, donc Cloudflare n'atteindra jamais l'origine → **erreur 522**. Pour que ce montage fonctionne il faudrait rouvrir 80/443 au monde, ce qui annule les phases 3 à 5.
>
> Ici, l'enregistrement DNS est un **CNAME vers le tunnel**, et il est **créé automatiquement** quand tu ajoutes la published route. Ne le crée pas à la main, ne le remplace pas par un A.
>
> À noter : le nuage **est** orange, et c'est normal — les CNAME de tunnel sont obligatoirement proxifiés (`cfargotunnel.com` n'est pas résolvable publiquement). C'est le seul point commun avec le conseil habituel.

Pour chaque web-app publique :

1. **Cloudflare → ton tunnel → Configure → Published application routes → Add**
   - Subdomain : `app`
   - Domain : `nspace.link`
   - Service : **HTTP** → `dokploy-traefik:80`
   - (le CNAME est créé automatiquement)
2. **Dokploy → l'app → Domains → Create**
   - Host : `app.nspace.link` (identique, au caractère près)
   - Container Port : le port réel de l'app
   - **HTTPS : désactivé, Certificate Provider : None**

> **Pourquoi pas de Let's Encrypt ici :** le challenge HTTP-01 exige que le port 80 soit joignable publiquement. Il ne l'est pas — c'est voulu. Cloudflare termine le TLS à l'edge, le tunnel est chiffré, l'origine parle HTTP en clair sur le réseau Docker local. C'est le bon modèle.

---

### 5.6 ⚠️ Les images viennent de GHCR — le VPS ne construit JAMAIS

> **Le piège le plus coûteux du montage, parce qu'il ne se voit pas.**

Une application Dokploy créée avec le provider **`Github`** clone le dépôt et
**construit l'image sur le serveur**. C'est le montage que proposent la plupart
des tutoriels, et il annule tout l'intérêt d'une chaîne CI : le VPS de
production compile, avec ses 4 vCPU, à chaque mise en ligne.

**La règle : `Source Type` sur `Docker`**, image `ghcr.io/<owner>/<app>:latest`.
GitHub Actions construit et pousse ; Dokploy tire.

Pour tirer un paquet GHCR privé, il faut un identifiant de registre :
`Settings → Registry → Add Registry` — `Registry URL` = `ghcr.io` (le nom
d'hôte seul), `Username` = le compte GitHub, `Password` = un PAT **classique**
avec le scope `read:packages`, `Image Prefix` = le compte.

**Comment la dérive passe inaperçue.** `application.deploy` répond `200` que
Dokploy tire ou qu'il construise. Un `deploy.yml` peut donc être vert de bout en
bout — build, poussée sur GHCR, appel de déploiement — pendant que le serveur
reconstruit à partir des sources et que les images poussées ne servent à
personne. Constaté sur owlog le 2026-08-20, après trois semaines.

Pire que le gaspillage : les deux chemins **divergent**. GitHub construit avec
les `build-args` du workflow (secrets lus dans Doppler, adresses d'API) ; le
build du VPS ne les a pas. L'image en ligne n'est alors pas celle que la CI a
validée.

**Le seul critère qui fait foi est le journal de déploiement Dokploy :**

| On doit y lire | On ne doit JAMAIS y lire |
| --- | --- |
| `Pulling from <owner>/<app>` | `Receiving objects:` (git clone) |
| `Status: Downloaded newer image for …` | `Building <app>-xxxxx` |
| `✅ Pulling image completed.` | `#5 [build 1/14] FROM …` |

**Et ça se teste.** Après l'appel de déploiement, le workflow interroge
`GET /api/application.one?applicationId=…` (en-tête `x-api-key`) et échoue si
`sourceType` n'est pas `docker` ou si `dockerImage` n'est pas l'image qu'il
vient de pousser. Implémentation de référence : `t3hx/myPortfolio`,
`.github/workflows/deploy.yml`.

## Phase 6 — Services admin (Tailscale uniquement)

Trois options, de la plus simple à la plus propre.

### Option A — IP + port (baseline)

Le service publie un port hôte, tu l'atteins en `http://100.x.y.z:PORT`.
Simple, mais pas de TLS, pas de nom lisible, et ça repollue les ports hôte.

### Option B — Sous-domaine pointant vers l'IP tailnet ⭐ recommandé

Astuce : un enregistrement DNS public peut parfaitement contenir une IP `100.64.0.0/10`. Elle n'est routable que depuis ton tailnet.

1. **Cloudflare → DNS → Add record**
   - Type `A`, Name `beszel`, Content `100.x.y.z`
   - **Proxy status : DNS only (nuage gris)** — obligatoire
2. **Dokploy → l'app → Domains** : Host `beszel.nspace.link`, port du conteneur
3. **Ne crée aucune published route dans le tunnel pour ce sous-domaine.**

Résultat : depuis le tailnet, `beszel.nspace.link` → `100.x.y.z:80` → Traefik route par le header Host. Depuis Internet, l'IP est injoignable. Zéro conteneur en plus.

Pour tout le lot d'un coup, tu peux faire un `A` wildcard sur un préfixe dédié : `*.int.nspace.link` → `100.x.y.z`, gris. Puis nommer tes services `beszel.int.nspace.link`, etc.

### Option C — Option B + vrai certificat TLS (DNS-01)

Nécessaire si un service exige un *secure context* (WebAuthn, presse-papier, service workers) — typiquement Vaultwarden.

1. Cloudflare → **My Profile → API Tokens** → token avec `Zone:DNS:Edit` sur `nspace.link`
2. Dokploy → **Web Server → Traefik → Environment Variables** : `CF_DNS_API_TOKEN=...`
3. Dokploy → **Web Server → Traefik File System** → éditer `traefik.yml`, ajouter un résolveur à côté de l'existant :

```yaml
certificatesResolvers:
  letsencrypt:            # existant, HTTP challenge — ne fonctionnera plus, c'est normal
    acme:
      email: toi@exemple.com
      storage: /etc/dokploy/traefik/dynamic/acme.json
      httpChallenge:
        entryPoint: web
  letsencrypt-dns:        # nouveau
    acme:
      email: toi@exemple.com
      storage: /etc/dokploy/traefik/dynamic/acme-dns.json
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "8.8.8.8:53"
```

4. Recharger Traefik (c'est de la config statique), puis sur le domaine de l'app : HTTPS **activé**, provider `letsencrypt-dns`.

Le challenge DNS ne nécessite aucun port entrant → parfaitement compatible avec ton verrouillage.

### 6.4 Exemple complet de bout en bout : Beszel

Beszel est un service d'admin → il suit l'**Option B**. Rien de ce qui suit ne touche au tunnel Cloudflare.

Architecture Beszel : un **hub** (dashboard web, port 8090) + un **agent** par machine surveillée. Sur le même serveur, hub et agent communiquent par socket Unix, ce qui évite d'exposer le port 45876.

---

#### Étape 1 — Enregistrement DNS chez Cloudflare

Cloudflare → `nspace.link` → **DNS → Records → Add record** :

| Champ | Valeur |
|---|---|
| Type | `A` |
| Name | `beszel` |
| IPv4 address | `100.x.y.z` ← **l'IP tailnet du serveur** (`tailscale ip -4`) |
| Proxy status | **DNS only** (nuage **gris**) |
| TTL | Auto |

⚠️ Le nuage **doit** être gris. En orange, Cloudflare essaierait de joindre `100.x.y.z` depuis son réseau — adresse non routable publiquement → erreur 522.

**Et surtout : ne crée AUCUNE published application route dans le tunnel pour `beszel`.** C'est l'absence de cette route qui garantit que le service reste privé.

---

#### Étape 2 — Créer le service dans Dokploy

Dashboard → **Projects** → `monitoring` (ou réutilise `infra`) → environnement **Production** → **Create Service** → **Compose**.

Onglet **General** :
- Compose Type : **Docker Compose**
- Provider / Source Type : **Raw**
- Coller :

```yaml
services:
  beszel:
    image: henrygd/beszel:latest
    restart: unless-stopped
    environment:
      APP_URL: http://beszel.nspace.link
    ports:
      - "127.0.0.1:8090:8090"
    volumes:
      - ../files/beszel_data:/beszel_data
      - ../files/beszel_socket:/beszel_socket
    networks:
      - dokploy-network

  beszel-agent:
    image: henrygd/beszel-agent:latest
    restart: unless-stopped
    network_mode: host
    volumes:
      - ../files/beszel_agent_data:/var/lib/beszel-agent
      - ../files/beszel_socket:/beszel_socket
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      LISTEN: /beszel_socket/beszel.sock
      HUB_URL: http://127.0.0.1:8090
      KEY: ${BESZEL_KEY}
      TOKEN: ${BESZEL_TOKEN}

networks:
  dokploy-network:
    external: true
```

Onglet **Environment** — crée les deux variables **vides pour l'instant** :

```
BESZEL_KEY=
BESZEL_TOKEN=
```

Puis **Deploy**.

**Explications ligne par ligne :**

| Ligne | Pourquoi |
|---|---|
| `../files/...` | Les chemins **absolus** en bind mount sont nettoyés à chaque déploiement par Dokploy. `../files/` est le répertoire persistant prévu pour ça. |
| `127.0.0.1:8090:8090` | L'agent tourne en `network_mode: host` et doit joindre le hub en HTTP. Publié sur la loopback uniquement → aucune exposition, même sans firewall. |
| `beszel_socket` partagé | Socket Unix entre hub et agent. Évite d'ouvrir le port 45876. |
| `network_mode: host` sur l'agent | Nécessaire pour lire les stats réseau de l'hôte. **Conséquence : l'agent ne peut pas être attaché à `dokploy-network`** — ne lui assigne jamais de domaine. |
| `networks: dokploy-network` sur le hub | Indispensable pour que Traefik l'atteigne. Dokploy l'ajoute automatiquement quand tu crées un domaine, mais l'écrire explicitement évite les surprises. |
| `docker.sock:ro` | Donne les stats par conteneur. Voir l'avertissement de sécurité plus bas. |

---

#### Étape 3 — Attacher le domaine (à faire AVANT d'ouvrir le hub)

> ⚠️ Le hub est publié sur `127.0.0.1:8090` uniquement — c'est volontaire (l'agent en `network_mode: host` en a besoin, et ça n'expose rien). **Conséquence : `http://100.x.y.z:8090` ne répondra jamais.** Il faut passer par Traefik, qui lui écoute sur `0.0.0.0:80` et est joignable via le tailnet.

Onglet **Domains** du service → **Add Domain** :

| Champ | Valeur |
|---|---|
| Service Name | `beszel` ← le nom du service **dans le compose**, pas celui du projet |
| Host | `beszel.nspace.link` |
| Path | `/` |
| Container Port | `8090` |
| HTTPS | **désactivé** pour l'instant |
| Certificate Provider | None |

Puis **Redeploy** — obligatoire.

> **Dokploy va afficher un avertissement du type « le domaine pointe vers 100.x.y.z au lieu de <IP publique> ». C'est normal, ignore-le.** Dokploy résout le domaine en DNS public et le compare à l'IP du serveur ; notre enregistrement A pointe volontairement vers l'IP tailnet, la comparaison ne matchera jamais. Ce voyant ne conditionne rien : Traefik route sur le header `Host`, il ne consulte pas le DNS. Le même avertissement (variante « derrière un CDN ») apparaîtra sur les apps publiques, dont le CNAME résout vers des IP Cloudflare.
>
> Ce désaccord n'aurait de conséquence réelle que pour un challenge Let's Encrypt **HTTP-01**, qu'on n'utilise nulle part ici.

Vérifie depuis le tailnet avant de continuer :

```bash
curl -I http://beszel.nspace.link    # -> 200 ou 302
```

> **Solution de repli** si le domaine ne répond pas encore et que tu veux avancer : port-forward SSH depuis ton poste — `ssh -L 8090:127.0.0.1:8090 thibault@100.x.y.z`, puis ouvre `http://localhost:8090`. Utile aussi pour diagnostiquer : si le hub répond par le tunnel SSH mais pas par le domaine, le problème est côté Traefik/domaine, pas côté Beszel.

---

#### Étape 4 — Le déploiement en deux temps (comportement attendu)

Au premier déploiement, **l'agent redémarre en boucle**. C'est normal, pas un bug : `KEY` est vide, l'agent ne peut pas parser la clé publique et sort avec `failed to parse key: ssh: no key found`. Le hub, lui, tourne correctement.

1. Ouvre **`http://beszel.nspace.link`** depuis le tailnet
2. Crée le compte admin
3. Bouton **Add System** en haut à droite. La boîte de dialogue affiche :
   - **Host / IP** : saisir `/beszel_socket/beszel.sock`
   - **Public Key** : la ligne complète `ssh-ed25519 AAAA...`
   - **Token** : la valeur générée
4. Retour dans Dokploy → onglet **Environment** du service :

```
BESZEL_KEY=ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...
BESZEL_TOKEN=<le-token>
```

5. **Redeploy**

L'agent démarre alors, et le système passe en vert dans le hub.

> Pour les services Compose, Dokploy injecte les labels Traefik **dans le fichier compose au moment du déploiement**. Contrairement aux Applications, il n'y a pas de rechargement à chaud : un changement de domaine sans redéploiement ne prend jamais effet. Le bouton **Preview Compose** te montre le fichier tel que Dokploy va le déployer, labels inclus — utile pour vérifier avant de lancer.

---

#### Étape 5 — Vérification

Depuis une machine **dans le tailnet** :

```bash
dig +short beszel.nspace.link        # -> 100.x.y.z
curl -I http://beszel.nspace.link    # -> 200 ou 302
```

Depuis une machine **hors tailnet** :

```bash
dig +short beszel.nspace.link        # -> 100.x.y.z (le DNS est public, c'est normal)
curl -I --max-time 5 http://beszel.nspace.link   # -> timeout
```

Le fait que l'IP soit publiquement visible n'est pas une fuite : `100.64.0.0/10` est de l'espace CGNAT, non routable sur Internet.

---

#### Étape 6 — Passer en HTTPS (optionnel)

Une fois le résolveur `letsencrypt-dns` en place (§6 Option C) :

1. Onglet **Domains** → éditer le domaine → **HTTPS activé**, Certificate Provider `letsencrypt-dns`
2. Onglet **Environment** → `APP_URL: https://beszel.nspace.link` (aussi dans le compose)
3. **Redeploy**

---

#### ⚠️ Note de sécurité spécifique à Beszel

Le montage `/var/run/docker.sock` — même en `:ro` — équivaut à un accès root sur l'hôte : l'API Docker permet de créer des conteneurs privilégiés, de lire les variables d'environnement de tous les autres conteneurs et d'accéder à leurs volumes. Le `:ro` ne restreint que l'accès au fichier socket, pas les opérations offertes par l'API.

Ce n'est pas théorique : **CVE-2026-27734** (corrigée en v0.18.4) permettait à un utilisateur Beszel authentifié d'atteindre des endpoints arbitraires de l'API Docker via des IDs de conteneurs non assainis.

Deux options selon ton curseur :
- **Tu veux les stats par conteneur** → garde le montage, mais surveille les mises à jour de Beszel plutôt que de figer la version indéfiniment.
- **Les stats hôte te suffisent** (CPU/RAM/disque/réseau du serveur) → **retire la ligne `docker.sock`**. C'est le choix cohérent avec un objectif de surface d'attaque minimale.

---

#### Récapitulatif : le même service, en version publique

Si un jour tu voulais rendre Beszel public — à titre d'illustration, ce n'est pas recommandé pour un dashboard d'admin — la **seule** chose à changer serait :

| | Privé (Option B) | Public (§5.5) |
|---|---|---|
| DNS Cloudflare | `A` → `100.x.y.z`, gris | `CNAME` → tunnel, créé auto |
| Route dans le tunnel | aucune | `beszel` → `dokploy-traefik:80` |
| Compose | identique | identique |
| Onglet Domains | identique | identique |

Le service, le compose et la config Dokploy ne bougent pas. Tout se joue sur deux réglages côté Cloudflare.

---

## Phase 7 — Checklist de validation

Depuis une machine **hors tailnet** :

```bash
nmap -Pn -p- <IP_PUBLIQUE>          # tout filtered
curl -I https://app.nspace.link     # 200, cert Cloudflare
curl -I https://beszel.nspace.link  # timeout / injoignable
curl -sD - -o /dev/null https://owlog.nspace.link/sw.js | grep -i cache-control
                                    # no-cache — sinon, Browser Cache TTL (§5.2)
```

Depuis le tailnet :

```bash
ssh thibault@serveur.tailXXXX.ts.net
curl -I http://100.x.y.z:3000       # Dokploy
curl -I https://beszel.nspace.link  # service admin
```

Sur le serveur :

```bash
ss -tlnp                   # inventaire réel des ports en écoute
docker ps                  # traefik + dokploy + postgres + redis + cloudflared
tailscale status
swapon --show
systemctl status fail2ban unattended-upgrades
docker logs <cloudflared>  # 4 connexions edge
```

---

## Phase 8 — Ce qui reste à décider / faire ensuite

- **Exploitation Owlog (temps 2).** Les procédures applicatives vivent dans
  [DEPLOY.md](DEPLOY.md), qui fait autorité : sauvegarde quotidienne chiffrée
  et **restauration depuis dump** (§8, exécutée de bout en bout le
  2026-07-30), **rotation des secrets e-mail** (§9), et l'hypothèse
  `CF-Connecting-IP` (§1) — l'en-tête n'est cru que parce que l'origine
  n'est joignable QUE par le tunnel ; si ce verrouillage réseau change un
  jour, cette hypothèse tombe avec lui et `OWLOG_TRUSTED_PROXIES` doit être
  repensée dans le même geste.
- **Sauvegardes système.** Le verrouillage réseau ne protège de rien contre un disque corrompu. Minimum : snapshots netcup + Dokploy Backups vers un S3 **externe** (pas ton Garage sur la même machine). Les dumps Postgres d'Owlog sont couverts par DEPLOY.md §8.
- **Webhooks n8n.** Seul cas qui demande une published route ciblée : expose `n8n.nspace.link` dans le tunnel mais protège `/` par une policy Cloudflare Access, en laissant `/webhook/` et `/webhook-test/` ouverts. L'éditeur reste accessible par Tailscale.
- **CI/CD.** Runner GitHub Actions qui rejoint le tailnet (`tailscale/github-action`), build + push vers GHCR, puis appel de l'API Dokploy sur son IP tailnet. Aucun webhook public.
- **Surveillance de l'expiration des clés Tailscale** — à revérifier si tu ajoutes des nœuds plus tard.

---

## Ordre des opérations, en résumé

```
OS + user + SSH keys
  └─ Tailscale up + désactiver l'expiration de clé
       └─ TEST SSH via tailnet  ← point de non-retour
            └─ Firewall netcup (avec règle 22 temporaire) + UFW
                 └─ Dokploy + advertise-routes
                      └─ Cloudflare Tunnel + première app publique
                           └─ Supprimer la règle 22  ← verrouillage final
                                └─ nmap depuis l'extérieur
```
