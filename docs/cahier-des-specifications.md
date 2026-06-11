# Cahier des spécifications — « Pac-Mage » : Pac-Man dans l'univers Harry Potter

> Jeu multijoueur collaboratif type *Twitch Plays Pokémon*, projeté sur les écrans d'un bar, contrôlé collectivement par les téléphones des joueurs.

- **Version** : 1.2 (corrections M2.5 : plein écran adaptatif, déplacement auto optionnel, salle = porte unique, IA pathfinding, murs de contour + tunnels visibles)
- **Date** : 11 juin 2026
- **Statut** : 🟢 Validé, prêt à construire
- **Design de référence** : mockup « pacman-hp » (« La Carte Ensorcelée »), voir §10 et `mockup-reference.png` ; maquette conceptuelle de carte 23×23 voir §6 bis et `map-concept.png`

---

## 1. Contexte et objectifs

Le jeu est une **animation de bar**. Plusieurs écrans, reliés via un **switch HDMI** à un seul ordinateur, affichent **exactement la même image**. Les clients rejoignent la partie en scannant un QR code à l'écran ; leur téléphone devient une **manette** à 4 directions.

Tous les joueurs contrôlent **le même personnage** (un seul avatar à l'écran), à la manière de *Twitch Plays Pokémon*. L'**animateur** dispose d'une interface de pilotage.

Objectif d'expérience : un jeu **convivial, lisible de loin, immédiatement compréhensible**, qui crée de l'émulation collective dans la salle, avec un **rendu visuel pro** fidèle au mockup.

### Objectifs produit
- Rejoindre une partie en moins de 15 secondes (scan QR → pseudo → manette).
- Aucune installation : tout passe par le navigateur mobile, **fonctionne en 4G**.
- Robustesse « bar » : connexions instables, joueurs qui arrivent/partent en continu, joueur qui change d'app et revient.
- Déploiement final **100 % dockerisé**. **Développement sur le serveur de dev** (`/home/pachp.ltn.re`), mise en prod ensuite sous `pachp.ltn.re`.

---

## 2. Glossaire et acteurs

| Terme | Définition |
|---|---|
| **Écran de jeu / Affichage** | Vue projetée sur tous les écrans du bar (identique partout). Navigateur plein écran sur TV, **adaptatif (100 vw × 100 vh), sans défilement**. |
| **Manette** | Page web mobile servie au joueur après scan du QR. 4 boutons directionnels. S'adapte à tous smartphones/navigateurs. |
| **Interface animateur** | Console d'administration privée, non projetée. |
| **Joueur** | Personne connectée via son téléphone, émettant des inputs directionnels. |
| **Avatar** | Le personnage unique déplacé collectivement (le « Vagabond » / Pac-Mage). |
| **Poursuivant** | Personnage à éviter (Rusard, Miss Teigne, Rogue, Peeves, Baron Sanglant). |
| **Baguette** | Collectible optionnel (mode « collecte ») à ramasser avant la Salle sur Demande. |
| **Salle sur Demande** | Objectif d'un niveau, sous forme de **petite pièce** (zone ouverte de plusieurs cases) ; y entrer fait passer au niveau suivant. |
| **Carte / Grille** | Le labyrinthe jouable, défini par une grille de cases (couloir / mur / Salle / spawns). Créée et éditée depuis l'admin (§6 bis), nommée et persistée. |
| **Mode Démocratie** | Un seul input joué = **vote majoritaire** sur une fenêtre de X secondes. |
| **Mode Chaos** | Tous les inputs des joueurs entrent dans une **file appliquée séquentiellement**. |
| **Serveur** | Backend autoritaire qui tient l'état du jeu et diffuse l'affichage. |

---

## 3. Vue d'ensemble de l'architecture

Le **serveur est autoritaire** : il calcule toute la logique (déplacement avatar, IA poursuivants, collisions, baguettes, niveaux, vies). L'écran de jeu est un **client d'affichage** (« dumb renderer ») qui reçoit l'état et le dessine. Les manettes n'envoient que des **intentions de direction**. Cela garantit que tous les écrans montrent la même chose et qu'aucun joueur ne triche localement.

Trois clients web partagent le même backend :
1. **`/screen`** — l'affichage projeté (TV 1920×1080).
2. **`/play`** — la manette mobile.
3. **`/admin`** — la console animateur (protégée par secret).

```
                    ┌─────────────────────────────────────┐
                    │           SERVEUR (Docker)            │
                    │  ┌─────────────┐   ┌───────────────┐  │
                    │  │ Moteur de   │◄─►│ Serveur Web +  │  │
                    │  │ jeu (boucle │   │ WebSocket      │  │
                    │  │ autoritaire)│   │ (état diffusé) │  │
                    │  └─────────────┘   └───────┬────────┘  │
                    └────────────────────────────┼───────────┘
                       ▲             ▲            │
          (affichage)  │   (admin)   │            │ (inputs / état)
              ┌────────┴───┐  ┌──────┴─────┐  ┌────┴─────────┐
              │ ÉCRAN (TV) │  │ ANIMATEUR  │  │ MANETTES ×N  │
              └────────────┘  └────────────┘  └──────────────┘
```

---

## 4. Spécifications fonctionnelles — Affichage (écran de jeu)

**Plein écran adaptatif** : l'affichage remplit exactement la fenêtre du navigateur (`100 vw × 100 vh`), s'adapte à n'importe quelle résolution (TV 1080p, 4K, projecteur…), sans défilement. La taille de cellule est recalculée dynamiquement selon la résolution disponible. Style « parchemin ensorcelé » fidèle au mockup (§10).

### 4.1 Disposition (mise à jour d'après le mockup et tes retours)

```
┌─────────────────────────────────────────────────────────────────────┐
│  La Carte Ensorcelée            ❤❤❤  │ Baguettes 2/3 │ Étage 1        │  ← barre de titre COMPACTE
├──────────────┬──────────────────────────────────────────┬───────────┤
│ ┌──────────┐ │                                           │  CADRE     │
│ │ QR code  │ │                                           │  DE VOTE   │
│ │ Rejoignez│ │            ZONE DE JEU                     │  (à droite,│
│ │ la quête │ │       (carte des Maraudeurs : avatar,      │   vertical)│
│ └──────────┘ │        poursuivants, baguettes,            │  ↑ ▓░ 1    │
│              │        Salle sur Demande)                  │  ↓ ▓▓▓ 3   │
│  LE GRAND    │       — maximisée —                        │  ← ▓░ 1    │
│  CHAHUT      │                                           │  → ░ 0     │
│  @pseudo  →  │                                           │            │
│  @pseudo  ↓  │                                           │  3 tours   │
│  @pseudo  →  │                                           │  joués     │
│  …(défile)   │                                           │            │
└──────────────┴──────────────────────────────────────────┴───────────┘
```

**Corrections design appliquées (vs mockup) :**
- **Barre de titre réduite** : moins haute, prend moins de place verticale.
- **Sous-titre supprimé** (« Le labyrinthe des spectres »). On garde le titre « La Carte Ensorcelée ».
- **« Trésor / 100 » remplacé par « Baguettes X/Y »** (ex. `2/3`). **Ce cadre n'apparaît pas** si le niveau n'a pas de baguettes à collecter.
- **Chat resserré** : supprimer l'espace perdu entre le pseudo et la flèche d'input (colonnes compactes).
- **Cadre de vote déplacé** : du bas vers la **droite de la zone de jeu**, en vertical, pour **maximiser la carte**. La phrase « Le peuple dirige le Vagabond » est **supprimée**.
- **QR code en haut à gauche, au-dessus du chat** (comme le mockup).
- **Textes du bloc QR** : titre « **Rejoignez la quête** » ; sous-texte « **Scannez le sceau pour aider nos amis à rejoindre la salle sur demande** » ; compteur « **XX sorciers connectés** » (au lieu de « reliés »).
- **Panneau « Tweaks »** (bas-droite du mockup) : **n'apparaît pas** sur l'écran de jeu. Ses réglages sont déplacés dans la page admin (§6), **sauf « Position du chat »** (le chat reste fixé à gauche).

### 4.2 Zone de jeu (centre, maximisée)
- Carte des Maraudeurs (labyrinthe), avatar, poursuivants actifs, baguettes (si mode collecte), Salle sur Demande.
- Animation fluide (30–60 fps côté rendu).
- Indicateur de direction courante de l'avatar.

### 4.3 Chat « Le Grand Chahut » (gauche, sous le QR)
- Liste défilante façon Twitch : `@pseudo` + flèche d'input (↑ ↓ ← →), colonnes **compactes**.
- Affiche les arrivées/départs (« @x est arrivé », « @x est parti »).
- **Tout afficher** (pas d'agrégation), y compris en mode Chaos.

### 4.4 Cadre de vote (droite de la carte)
- Barres horizontales par direction (↑ ↓ ← →) montrant la répartition des votes en temps réel + compteur par direction.
- Compteur « X tours joués ».
- Pertinent surtout en mode Démocratie (suspense collectif) ; peut aussi visualiser l'activité en Chaos.

### 4.5 Barre de titre (compacte)
- Titre « La Carte Ensorcelée ».
- **Points de vie** : 3 cœurs (vies partagées).
- **Baguettes X/Y** (masqué si pas de collecte au niveau).
- **Étage** (niveau 1 à 5).

### 4.6 États d'écran
- **Lobby / attente** : QR en avant, liste des connectés, « En attente du lancement par l'animateur ».
- **Pause auto** : si **zéro joueur connecté**, le jeu se met en pause.
- **En jeu** : disposition ci-dessus.
- **Transition de niveau** : court écran « Salle sur Demande atteinte ! Niveau suivant… ».
- **Game Over** : à 0 vie ; écran de fin + invitation à relancer.
- **Victoire finale** : « **L'Armée de Dumbledore vaincra !** » après le niveau 5.

---

## 5. Spécifications fonctionnelles — Manette (téléphone joueur)

### 5.1 Parcours joueur
1. Scan du QR → ouvre `/play?game=<id>` dans le navigateur mobile.
2. **Écran pseudo** : saisie + « Rejoindre » (validation longueur/caractères, filtre simple — §11).
3. **Écran manette** : D-pad thématisé à **4 boutons** (Haut / Bas / Gauche / Droite).
4. Chaque appui envoie une **intention de direction** via WebSocket.

### 5.2 Manette
- 4 boutons directionnels uniquement (avatar avance automatiquement).
- Retour visuel/haptique léger (vibration si supportée).
- Affiche pseudo + mode courant + mini-feedback éventuel.
- **S'adapte à tous smartphones/navigateurs** ; **pas d'orientation imposée**.
- **Sessions robustes** : le joueur peut recevoir un message / changer d'app / verrouiller l'écran, puis revenir et **continuer à jouer** — reconnexion transparente (identité conservée via token/cookie).
- Reste fonctionnelle entre niveaux et parties (pas besoin de re-scanner).

### 5.3 Arrivées / départs
- **Totalement transparents**, sans confirmation (juste un message dans le chat).
- Un joueur peut rejoindre **en cours de niveau** et devient immédiatement contrôleur.

---

## 6. Spécifications fonctionnelles — Interface animateur

Console privée, **non projetée**, protégée par secret.

**Pilotage de partie**
- Créer / lancer / réinitialiser / pause-reprise.
- **Mode de contrôle** : Démocratie ou Chaos.
- **Durée d'un vote** (fenêtre d'agrégation Démocratie), en secondes (ex. mockup : 4,5 s ; plage ~0,5–10 s).
- **Niveau de départ** (démo / reprise).
- Forcer transition de niveau / game over / victoire (contrôle manuel d'animation).

**Réglages de jeu (ex-« Tweaks » du mockup, déplacés ici)**
- **Mode objectif** : « atteindre la Salle sur Demande » **ou** « collecter N baguettes puis Salle sur Demande ».
- **Nombre de baguettes par niveau** (si mode collecte ; position aléatoire au lancement du niveau).
- **Vitesse des poursuivants** (réglable ; identique pour tous).
- **Vitesse de l'avatar** (réglable).
- **Ambiance / Atmosphère** : parchemin / chandelle / sortilège.
- **Police du titre** (ex. UnifrakturCook).
- **Tempo** : posé / animé / frénétique.
- **Traînées de pas** (on/off).
- *(Exclu : « Position du chat » — le chat reste fixé à gauche.)*

**Supervision & modération**
- État live : nombre de joueurs, niveau, mode, FPS, santé des connexions.
- Exclure/bannir un pseudo, vider le chat, masquer un joueur abusif (§11).

---

## 6 bis. Éditeur de cartes (intégré à l'admin)

La zone de jeu (le labyrinthe) est l'élément que l'animateur voudra **affiner, tester, recréer**. Elle n'est donc **pas codée en dur** : un éditeur de cartes dans l'admin permet de la créer, modifier, nommer et sélectionner sans toucher au code.

### 6 bis.1 Création / dessin
- **Taille de grille** : saisie largeur × hauteur (bornes proposées **11×11 à 41×41** ; dimensions impaires recommandées). Maquette de référence : **23×23** (`map-concept.png`).
- **Dessin** : clic / glisser pour **griser** (mur) ou **dégriser** (couloir) les cases — à l'image de la maquette conceptuelle. Outils : pinceau mur, gomme (couloir), tracer la bordure, tout effacer.
- **Types de cases** :
  - `couloir` (libre)
  - `mur` (grisé)
  - `Salle sur Demande` (pièce — zone ouverte de plusieurs cases, **exception** à la règle « couloir 1 case »)
  - `départ avatar` (unique)
  - `apparition poursuivant` (1 à 5 ; jusqu'à 5 utilisés selon le niveau)
- **Tunnels (wraparound)** visualisés : une case-couloir de bord communique avec la case opposée (gauche↔droite, haut↔bas). Un tunnel est **explicite** dans `tunnels` (lignes/colonnes) et exige que **les deux bords opposés** soient ouverts ; l'outil « Tunnel » de l'éditeur ouvre les deux côtés d'un coup.

### 6 bis.2 Gestion des cartes
- **Nommer / enregistrer / dupliquer / supprimer** une carte. Liste des cartes disponibles.
- **Sélection de la carte active** (utilisée à la prochaine partie). Par défaut, le changement de carte se fait au **lobby / reset**, pas en plein niveau.
- **Carte par défaut « pacman »** fournie de base (= maquette conceptuelle 23×23).
- **Export / import** d'une carte (fichier JSON) — pratique pour sauvegarder/partager.

### 6 bis.3 Génération aléatoire
- Bouton **« Générer »** avec paramètres (taille, densité de murs, nombre de spawns poursuivants).
- **Règles respectées** :
  - couloirs de **1 case de large** (aucune zone ouverte 2×2, hors pièce Salle) ;
  - **style à boucles type Pac-Man** (plusieurs chemins, peu de culs-de-sac) ;
  - **connexité** : toutes les cases-couloir atteignables ;
  - **placement obligatoire d'une Salle sur Demande** (pièce) atteignable ;
  - placement du **départ avatar** et des **spawns poursuivants** ;
  - **tunnels** possibles (ouvertures de bord).
- Une carte générée est **éditable** ensuite, exactement comme une carte nommée.

### 6 bis.4 Validation (avant activation)
Une carte n'est activable que si : une Salle sur Demande présente avec une **porte unique** (case couloir adjacente à la Salle), un **départ avatar unique**, **1 à 5 spawns** poursuivants, **connexité** des couloirs (tunnels compris), **aucun couloir > 1 case** hors pièce Salle (aucune zone ouverte 2×2), et un **contour fermé sauf aux tunnels** (chaque tunnel ouvre les deux bords opposés). Les erreurs sont signalées dans l'éditeur ; l'activation d'une carte invalide est refusée côté serveur.

### 6 bis.5 Persistance
Cartes stockées en **fichiers JSON dans un volume Docker** (survivent aux redémarrages), **sans base de données**. Format indicatif :
```
Map {
  name, width, height,
  cells: [[ ... ]],   // 0=couloir, 1=mur, 2=salle, 3=départ avatar, 4=spawn poursuivant
  avatarStart: {r, c},
  pursuerSpawns: [{r, c}, ...],
  room: [{r, c}, ...],
  roomDoor: {r, c},          // porte unique vers la salle (case couloir, seule entrée)
  tunnels: { horizontal: [rowIdx], vertical: [colIdx] },
  createdAt, updatedAt
}
```

---

## 7. Spécifications fonctionnelles — Mécaniques de jeu

### 7.1 Déplacement (style Pac-Man, à l'identique)
- **Mode déplacement automatique (réglable admin)** :
  - **Activé (défaut)** : l'avatar avance automatiquement à vitesse constante le long des couloirs ; les joueurs ne choisissent que la direction.
  - **Désactivé** : l'avatar ne bouge que d'une case à chaque direction jouée (Démocratie ou Chaos) — aucun déplacement automatique entre deux inputs.
- Une direction n'est appliquée que si un virage est possible ; sinon elle est mise en file jusqu'à la prochaine intersection compatible (comportement Pac-Man classique).
- Murs = cases grisées de la grille ; pas de traversée.
- **Tunnels (wraparound)** : la carte possède un **mur de contour** sur tout le pourtour, avec **uniquement les ouvertures de tunnel** comme trouées (rendues visuellement distinctes — flèche colorée). Les tunnels permettent le wraparound **gauche ↔ droite** et **haut ↔ bas**.
- **La carte est définie par la grille active** (éditeur, §6 bis). Les 5 niveaux se jouent sur la **même carte** ; seul le nombre de poursuivants change. La carte par défaut « pacman » reprend la maquette conceptuelle 23×23.

### 7.2 Mode Démocratie
- Inputs collectés sur une **fenêtre glissante de X secondes** (réglable, « Durée d'un vote »).
- À chaque tick de décision : **vote majoritaire** → direction la plus demandée appliquée.
- **Égalité** : **choix aléatoire** entre les directions à égalité.
- Le cadre de vote (§4.4) affiche la répartition en temps réel.

### 7.3 Mode Chaos
- **Tous les inputs entrent dans une file appliquée séquentiellement** (chaque input demande un virage à la prochaine intersection compatible). C'est l'empilement des intentions de tous les joueurs qui produit le chaos.

### 7.4 Poursuivants
- **IA pathfinding réel** : chaque poursuivant calcule son prochain pas par **BFS** (largeur d'abord) dans le labyrinthe, en tenant compte des tunnels wraparound. 30 % de chance de déviation aléatoire par tick (comportement non déterministe). Pas de rapprochement à vol d'oiseau.
- **Même vitesse pour tous, aucune capacité spéciale** ; vitesse **réglable** par l'animateur.
- **Collision avatar / poursuivant = perte d'une vie** (voir §7.7).
- Nombre de poursuivants croissant selon le niveau (§8).

### 7.5 Baguettes (collectibles — selon mode admin)
- Si **mode collecte** activé : N **baguettes magiques** apparaissent à des **positions aléatoires** au lancement du niveau (N réglable par niveau).
- Il faut **toutes les collecter** avant que la Salle sur Demande ne valide le niveau.
- Compteur « Baguettes X/Y » affiché (sinon cadre masqué).

### 7.6 Salle sur Demande (objectif)
- **Petite pièce** (zone ouverte de plusieurs cases) définie dans la grille ; **position fixe** sur la carte active.
- **Porte unique** : l'accès à la pièce ne se fait que par **une seule case « porte »** (`roomDoor` dans le format de carte) — le reste du contour de la pièce est mur. La porte est visuellement distincte (arche verte sur `/screen`).
- Franchir la porte **termine le niveau** (à condition d'avoir collecté toutes les baguettes si mode collecte).

### 7.7 Vies, victoire, défaite
- **3 vies partagées** (un seul joueur « logique » collectif).
- Collision → −1 vie ; à **0 vie → game over** (relance possible).
- **Pas de limite de temps.**
- Atteindre la Salle sur Demande du niveau 5 → **victoire** : « L'Armée de Dumbledore vaincra ! ».
- **Pas de score ni classement** : tout est éphémère.

### 7.8 Difficulté
- **Vitesse fixe** (non croissante automatiquement). La difficulté vient du **nombre de baguettes**, du **nombre d'ennemis à l'écran**, et de **leur vitesse** (réglés via l'admin).

---

## 8. Les 5 niveaux

Même carte pour tous ; seul le **nombre de poursuivants** augmente.

| Niveau | Poursuivants | Nb |
|---|---|---|
| **1** | Rusard | 1 |
| **2** | Rusard, Miss Teigne | 2 |
| **3** | Rusard, Miss Teigne, Severus Rogue | 3 |
| **4** | Rusard, Miss Teigne, Severus Rogue, Peeves | 4 |
| **5** | Rusard, Miss Teigne, Severus Rogue, Peeves, Baron Sanglant | 5 |

Atteindre la Salle sur Demande → niveau suivant. Après le niveau 5 → message de victoire final.

---

## 9. Spécifications techniques

### 9.1 Stack (validée)

| Couche | Choix | Justification |
|---|---|---|
| Backend / moteur | **Node.js (TypeScript)** | Boucle autoritaire temps réel ; langage unique front/back. |
| Temps réel | **WebSocket (Socket.IO ou `ws`)** | Reconnexion auto, rooms, broadcast ; robuste en réseau instable. |
| Rendu écran & manette | **HTML5 + Canvas** (vanilla / léger type PixiJS) | 2D performant, lisible, même base `/screen` et `/play`. |
| Admin | Page web même stack | Léger. |
| QR code | lib `qrcode` | QR à la volée avec ID de partie. |
| Conteneurisation | **Docker + Docker Compose** | Exigence ; aligné infra. |

### 9.2 Architecture serveur (autoritaire)
- Boucle de jeu à fréquence fixe (tick logique ~10–20 Hz).
- Par tick : intégration inputs (selon mode), déplacement avatar, IA poursuivants, collisions, baguettes, niveau, vies.
- État sérialisé diffusé (broadcast) à `/screen` ; rendu client interpolé pour la fluidité.
- **Une seule partie globale active** ; **pause auto si zéro joueur**.

### 9.3 Modèle d'état (indicatif)
```
GameState {
  status (lobby|playing|paused|levelTransition|gameover|won),
  mode (democracy|chaos), voteWindowSec,
  objectiveMode (room|collect), level (1..5), lives (≤3),
  activeMap: { name, width, height, cells[][], avatarStart, pursuerSpawns[], room },
  // cells : 0=couloir 1=mur 2=salle 3=départ avatar 4=spawn poursuivant ; tunnels = bords ouverts
  avatar: { x, y, dir, queuedDir, speed },
  pursuers: [ { type, x, y, dir, speed } ],
  wands: [ { x, y, collected } ],     // si objectiveMode=collect
  players: { [id]: { pseudo, connected, lastInput, lastSeen } },
  inputBuffer: [...],                  // démocratie: inputs horodatés ; chaos: file
  voteTally, timers, settings(tempo, atmosphere, titleFont, footprints, pursuerSpeed)
}
```

### 9.4 Protocole temps réel (indicatif)
**Client → Serveur** : `player:join {pseudo}`, `player:input {dir}`, `player:reconnect {token}` ; `admin:auth`, `admin:start`, `admin:setMode`, `admin:setVoteWindow`, `admin:setObjectiveMode`, `admin:setWandCount`, `admin:setPursuerSpeed`, `admin:pause`, `admin:reset`, `admin:kick`, `admin:forceLevel` ; **cartes** : `map:list`, `map:get {name}`, `map:save {map}`, `map:duplicate {name}`, `map:delete {name}`, `map:generate {params}`, `map:validate {map}`, `map:setActive {name}`.
**Serveur → Clients** : `state:update {gameState}`, `players:update`, `chat:event`, `level:transition`, `game:over`, `game:won`, `player:welcome {id, token, mode}`.

### 9.5 Conteneurisation
- Image unique « pachp » (Node) servant `/screen`, `/play`, `/admin` + WebSocket (port interne ex. 3000).
- `docker-compose.yml` : service, variables d'env (secret admin, URL publique), `restart: unless-stopped`, rattachement au réseau du reverse proxy.
- **Pas de base de données** pour l'état de jeu (en mémoire, éphémère). **Exception** : les **cartes** sont persistées en **fichiers JSON dans un volume Docker** (`/data/maps/*.json`) — survivent aux redémarrages.
- `Dockerfile` multi-stage (build TS → `node:20-alpine`).

### 9.6 Environnements
**Dev (serveur de test — vérifié le 11/06/2026)**
- Debian 13 (trixie), **Docker 29.4.3**, **Compose v5.1.3**, 4 vCPU, ~3,7 Go RAM, hôte `openclauf`.
- Dépôt de travail : **`/home/pachp.ltn.re`** (à créer ; nécessite sudo).
- **Critère d'acceptation initial** : tout fonctionne sur un **port exposé de l'IP du serveur de dev**.

**Prod (serveur de production — vérifié le 10/06/2026)**
- Debian 12, Docker 29.1.1, Compose v2.40.3, 4 vCPU, ~7,7 Go RAM.
- Reverse proxy **Nginx Proxy Manager** (réseau `nginx-proxy-network`), pattern `*.ltn.re`.
- Sous-domaine cible **`pachp.ltn.re`** ; le Proxy Host (avec **WebSocket + SSL/WSS**) sera **créé par Arnaud** en temps voulu.
- **Accès Internet requis** : QR + manette doivent fonctionner depuis un téléphone en **4G**.

---

## 10. Design de référence et assets

**Référence visuelle** : mockup « pacman-hp » / « La Carte Ensorcelée » (capture dans `mockup-reference.png`). Style **parchemin vieilli, encre sépia/bordeaux, typographie gothique** (UnifrakturCook pour le titre). Rendu **pro** attendu, fidèle au mockup, avec les corrections du §4.1.

**Usage privé** : on peut **reprendre des assets de l'IP Harry Potter** (noms et personnages).

**Assets à produire (par IA, style cohérent)** :
- Fond de carte « Maraudeurs » (labyrinthe jouable, lisible).
- Avatar (le Vagabond).
- Poursuivants : Rusard, Miss Teigne, Rogue, Peeves, Baron Sanglant (reconnaissables en petit).
- Baguette (collectible), Salle sur Demande (porte-objectif).
- D-pad manette thématisé (4 boutons).
- Habillage UI : cadres parchemin, cœurs (vies), cadre de vote, écran de victoire.

**Contraintes** : lisibilité à distance (contraste fort, formes simples) ; tout tient en 1920×1080 sans scroll.

---

## 11. Sécurité, modération, robustesse
- Pseudos bornés, filtre simple anti-insultes ; kick possible par l'animateur.
- Console admin protégée par secret, non exposée publiquement.
- Rate limiting des inputs par joueur (anti-spam).
- Nettoyage des joueurs inactifs après timeout ; reconnexion propre (changer d'app et revenir).
- Aucune donnée personnelle persistée (pseudos éphémères en mémoire).

---

## 12. Performance et contraintes
- Cible : **jusqu'à ~50 joueurs simultanés** sur un seul serveur.
- Découplage tick logique / rendu ; stabilité plusieurs heures sans fuite mémoire.
- Latence perçue acceptable (< quelques centaines de ms) entre appui et effet.

---

## 13. Décisions validées (ex-zones d'ombre)

| # | Sujet | Décision |
|---|---|---|
| 1 | Défaite | 3 vies partagées ; game over à 0 vie. |
| 2 | Démocratie | Vote majoritaire ; égalité → choix aléatoire entre ex æquo. |
| 3 | Chaos | File d'inputs appliquée séquentiellement. |
| 4 | Collectibles | Paramètre admin : objectif direct **ou** collecter N baguettes (N/niveau réglable, positions aléatoires au lancement) avant la Salle. |
| 5 | Poursuivants | Même vitesse, pas de capacité ; vitesse réglable admin. |
| 6 | Salle sur Demande | Position fixe ; carte = niveau Pac-Man à l'identique. |
| 7 | Difficulté | Vitesse fixe ; difficulté via nb baguettes, nb ennemis, vitesse. |
| 8 | Chrono | Pas de limite de temps. |
| 9 | Joueurs max | ~50. |
| 10 | Sessions | Une seule partie globale. |
| 11 | Arrivée/départ | Transparents (message chat) ; pause auto si 0 joueur. |
| 12 | Chat | Tout afficher. |
| 13 | Orientation manette | Aucune imposée. |
| 14 | Score/classement | Aucun ; tout éphémère. |
| 15 | Stack | Node.js / TypeScript. |
| 16 | Déploiement | Dev sur serveur de test `/home/pachp.ltn.re` ; prod `pachp.ltn.re`, Proxy Host créé par Arnaud. |
| 17 | Réseau | Doit fonctionner en 4G (Internet). |
| 18 | Juridique | Usage privé ; assets de l'IP autorisés. |
| 19 | Graphisme | Rendu pro fidèle au mockup « pacman-hp ». |
| 20 | Carte | Définie par une grille éditable (pas codée en dur) ; carte par défaut « pacman » 23×23. Mur de contour obligatoire, ouvertures de tunnel explicites. |
| 21 | Salle sur Demande | Petite pièce (zone ouverte), porte unique (`roomDoor`), position fixe, placée dans l'éditeur. |
| 22 | Spawns | Départ avatar + apparitions poursuivants placés dans l'éditeur. |
| 23 | Génération aléatoire | Style à boucles (Pac-Man), couloirs 1 case, connexité, salle obligatoire, tunnels ; résultat éditable. |
| 24 | Tunnels | Wraparound gauche↔droite et haut↔bas si les murs le permettent. |
| 25 | Persistance cartes | Fichiers JSON dans un volume Docker (sans base de données). |
| 26 | Changement de carte | Au lobby / reset (pas en plein niveau). |
| 27 | Déplacement auto | Réglable admin (on/off). Off = 1 case par input. |
| 28 | IA poursuivants | BFS dans le labyrinthe (tunnel inclus) + 30 % aléatoire. |
| 29 | Tunnels visuels | Ouvertures de tunnel distinguables sur /screen (flèche colorée). |
| 30 | Plein écran adaptatif | 100 vw × 100 vh, redimensionnement dynamique. |

---

## 14. Critères d'acceptation (definition of done)

- [ ] **Jalon initial** : tout fonctionne sur un **port exposé de l'IP du serveur de dev** (screen + play + admin connectés).
- [ ] Un joueur scanne le QR, saisit un pseudo, obtient une manette 4 directions en < 15 s, **en 4G**.
- [ ] L'écran s'adapte à **n'importe quelle résolution** (100 vw × 100 vh, sans scroll), fidèle au mockup corrigé (§4.1).
- [ ] L'avatar avance et tourne selon les directions, murs respectés (Pac-Man à l'identique).
- [ ] **Démocratie** : vote majoritaire sur fenêtre réglable, égalité aléatoire.
- [ ] **Chaos** : file d'inputs séquentielle.
- [ ] **Baguettes** : mode collecte fonctionnel (N réglable, positions aléatoires, compteur X/Y).
- [ ] **3 vies**, game over à 0, relance possible.
- [ ] L'admin : lancer/réinitialiser, mode, durée de vote, objectif, nb baguettes, vitesses, tempo, ambiance, modération.
- [ ] **5 niveaux** avec le bon nombre de poursuivants ; progression par la Salle sur Demande.
- [ ] Message final « L'Armée de Dumbledore vaincra ! » après le niveau 5.
- [ ] Chat « Le Grand Chahut » compact, défile, arrivées/départs.
- [ ] **Robustesse mobile** : changer d'app / verrouiller / revenir et continuer.
- [ ] Pause auto si 0 joueur.
- [ ] **Éditeur de cartes** : créer/dessiner, nommer, dupliquer, supprimer, sélectionner la carte active ; placer murs, Salle (pièce), départ avatar, spawns poursuivants.
- [ ] **Génération aléatoire** conforme (boucles, couloirs 1 case, connexité, salle obligatoire, tunnels) ; résultat éditable.
- [ ] **Validation** d'une carte avant activation ; cartes **persistées** en JSON (survivent au redémarrage).
- [ ] **Tunnels** fonctionnels (wraparound H et V).
- [ ] Carte par défaut « pacman » 23×23 disponible.
- [ ] Ensemble **dockerisé** ; prêt pour mise en prod via NPM en HTTPS/WSS.
- [ ] Stabilité sur une session de plusieurs heures.

---

*Fin du cahier des spécifications v1.0 — validé.*
