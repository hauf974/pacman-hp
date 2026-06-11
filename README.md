# Pac-Mage — Pac-Man × Harry Potter (multijoueur de bar)

Jeu Pac-Man projeté sur les écrans d'un bar, contrôlé collectivement par les téléphones des clients (manette web via QR code), façon *Twitch Plays Pokémon*. Serveur autoritaire temps réel, 5 niveaux, deux modes (Démocratie / Chaos), éditeur de cartes.

- **Spécifications** : `docs/cahier-des-specifications.md`
- **Brief de build** : `CLAUDE.md`

---

## Développement local

```bash
docker compose -f docker-compose.dev.yml up
```

Le hot-reload est actif (`ts-node-dev`) ; les sources sont montées en volume.  
Accès : `http://localhost:3000` → `/screen`, `/play`, `/admin`

Variables d'environnement (optionnelles en dev, valeurs par défaut utilisées sinon) :

| Variable | Défaut | Description |
|---|---|---|
| `ADMIN_SECRET` | `pacmage-admin` | Secret de la console admin |
| `PUBLIC_URL` | `http://localhost:3000` | URL publique (QR code + manette) |

```bash
# Optionnel : surcharger en dev
ADMIN_SECRET=mon-secret docker compose -f docker-compose.dev.yml up
```

---

## Déploiement en production

### Prérequis

- Docker + Docker Compose (v2) sur le serveur
- [Nginx Proxy Manager](https://nginxproxymanager.com/) installé et opérationnel
- Sous-domaine `pachp.ltn.re` pointant sur l'IP du serveur (DNS configuré)

### 1. Cloner le dépôt

```bash
git clone https://github.com/hauf974/pacman-hp.git
cd pacman-hp
```

### 2. Créer le fichier `.env`

```bash
cp .env.example .env
nano .env   # remplir ADMIN_SECRET et PUBLIC_URL
```

```dotenv
ADMIN_SECRET=un-secret-fort-aleatoire
PUBLIC_URL=https://pachp.ltn.re
```

### 3. Créer le réseau Docker externe (une seule fois)

```bash
docker network create nginx-proxy-network
```

> Ce réseau est partagé avec Nginx Proxy Manager. Si NPM tourne déjà et que le réseau existe, cette commande échoue avec "already exists" — c'est normal.

### 4. Lancer l'application

```bash
docker compose up -d --build
```

L'image est construite en deux étapes (TypeScript compilé dans un stage intermédiaire, seuls les artefacts de production sont dans l'image finale). La carte par défaut `pacman.json` est automatiquement copiée dans le volume `pacmage_maps` au premier démarrage.

### 5. Vérifier

```bash
docker compose logs -f        # suivre les logs
docker compose ps             # statut du conteneur
```

### 6. Configuration Nginx Proxy Manager (à faire par Arnaud)

Dans l'interface NPM, créer un **Proxy Host** avec les paramètres suivants :

| Paramètre | Valeur |
|---|---|
| Domain names | `pachp.ltn.re` |
| Scheme | `http` |
| Forward Hostname/IP | `pacmage` (nom du service Docker) |
| Forward Port | `3000` |
| **Websockets Support** | ✅ **Activé** (obligatoire) |
| SSL Certificate | Let's Encrypt (créer ou sélectionner) |
| Force SSL | ✅ Activé |
| HTTP/2 Support | ✅ Activé |

> **Le support WebSocket est obligatoire.** Sans lui, Socket.IO ne fonctionnera pas et ni la manette ni l'écran ne recevront les mises à jour de jeu.

### Mise à jour

```bash
git pull
docker compose up -d --build
```

Le volume `pacmage_maps` contenant les cartes personnalisées **est préservé** entre les mises à jour.

### Sauvegarde des cartes

```bash
docker run --rm -v pacmage_maps:/data alpine tar czf - /data > maps-backup.tar.gz
```

### Arrêt

```bash
docker compose down          # arrête et supprime les conteneurs (volume conservé)
docker compose down -v       # supprime aussi le volume (DÉTRUIT les cartes!)
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Serveur autoritaire                        │
│  Node.js + TypeScript — boucle de jeu 15 Hz                      │
│  gameEngine.ts (logique pure) + gameStore.ts (état centralisé)    │
│  Socket.IO — diffuse l'état à tous les clients                    │
└──────────────────────────────────────────────────────────────────┘
         ↑ /screen      ↑ /admin         ↑ /play (×N)
   (TV/projecteur)  (animateur)    (téléphones clients)
```

- **`/screen`** : affichage en grand (canvas, style Carte des Maraudeurs)
- **`/play`** : manette web (D-pad, reconnexion automatique via token)
- **`/admin`** : console animateur (secret requis)

### Persistance

L'état de jeu est en **mémoire** (éphémère). Seules les **cartes** sont persistées en JSON dans le volume Docker `pacmage_maps` (`/app/data/maps/*.json`).

### Sécurité

- Console admin protégée par `ADMIN_SECRET`
- Rate limiting des inputs joueur : 20 req/s par joueur
- Reconnexion transparente via token localStorage (5 min de grâce après déconnexion)
- `trust proxy` activé pour HTTPS correct derrière NPM

---

## Tests

```bash
npm test           # gameEngine + mapEngine + gameStore (117 tests)
npm run build      # vérification TypeScript
```
