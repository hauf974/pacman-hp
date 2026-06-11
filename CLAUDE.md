# CLAUDE.md — Pac-Mage (Pac-Man × Harry Potter, multijoueur « Twitch plays »)

> Brief de construction pour Claude Code. **Source de vérité fonctionnelle : `docs/cahier-des-specifications.md` (v1.1)** — à lire en entier avant de coder. Ce fichier en résume l'essentiel + les conventions de travail.

## Le projet en 5 lignes
Jeu Pac-Man projeté sur les écrans d'un bar. Un seul avatar, contrôlé collectivement par les téléphones des clients (manette web via QR code), façon *Twitch Plays Pokémon*. Serveur **autoritaire** temps réel. 5 niveaux sur la même carte, nombre de poursuivants croissant. Deux modes de contrôle : **Démocratie** (vote majoritaire sur fenêtre réglable) et **Chaos** (file d'inputs séquentielle). Éditeur de cartes dans l'admin.

## Stack
- **Backend** : Node.js + **TypeScript**, boucle de jeu autoritaire (tick ~10–20 Hz).
- **Temps réel** : WebSocket (Socket.IO ou `ws`), reconnexion auto.
- **Front** : HTML5 + Canvas (vanilla ou léger type PixiJS). Trois clients : `/screen`, `/play`, `/admin`.
- **Conteneurisation** : Docker + Docker Compose. État de jeu en mémoire ; **cartes persistées en JSON** dans un volume (`/data/maps/*.json`).

## Architecture
Serveur autoritaire : il calcule TOUT (déplacement avatar, IA poursuivants, collisions, baguettes, niveaux, vies) et diffuse l'état. `/screen` = rendu « bête ». `/play` = n'envoie que des intentions de direction. Une seule partie globale. Pause auto si 0 joueur.

## Layout du dépôt
```
src/server/   moteur de jeu, WebSocket, store de cartes, générateur aléatoire
src/shared/   types TypeScript partagés (GameState, Map, events)
src/client/screen|play|admin/   les 3 fronts
data/maps/    cartes JSON (défaut: pacman.json)
tests/        tests automatisés (logique critique)
docs/         cahier des specs, références visuelles
```

## Décisions figées (rappel — détail dans le cahier)
- 3 vies partagées ; game over à 0 ; pas de chrono ; pas de score (éphémère).
- Démocratie = vote majoritaire, égalité → aléatoire ; Chaos = file séquentielle.
- Objectif : atteindre la **Salle sur Demande** (petite pièce). Option admin « collecte » : ramasser N **baguettes** (positions aléatoires au lancement) avant la Salle.
- Poursuivants : même vitesse, sans capacité, vitesse réglable admin. Niveaux 1→5 = 1→5 poursuivants (Rusard, Miss Teigne, Rogue, Peeves, Baron Sanglant).
- Carte = grille éditable (pas codée en dur). Tunnels wraparound gauche↔droite et haut↔bas. Carte par défaut « pacman » 23×23.
- Éditeur de cartes (admin) : dessiner murs, placer Salle/avatar/spawns, nommer/dupliquer/supprimer, **générer aléatoirement** (boucles type Pac-Man, couloirs 1 case, connexité, salle obligatoire), valider, persister en JSON.
- ~50 joueurs max. Doit fonctionner en 4G (HTTPS/WSS en prod via Nginx Proxy Manager, sous-domaine `pachp.ltn.re`).
- Rendu **pro** fidèle au mockup « pacman-hp » (parchemin sépia, typo gothique). Voir `docs/` (références à fournir).

## Méthode de travail (IMPORTANT)
Construire par **jalons verticaux**, chacun livrable et testé. Commit git par jalon (messages clairs). Lancer les tests à chaque itération.

- **M1 — squelette** : serveur + WebSocket + `/screen` (carte statique rendue) + `/play` (pseudo + manette qui envoie des inputs) + `/admin` (lancer/reset). Critère : **tout fonctionne sur un port exposé de l'IP du serveur de dev**. → review Arnaud.
- **M2 — cœur** : déplacement Pac-Man (auto + virages en file), carte `pacman`, Salle sur Demande, mode Démocratie, 3 vies, niveau 1 avec Rusard.
- **M3 — complet** : mode Chaos, baguettes (mode collecte), 5 niveaux, game over/victoire, tous les réglages admin, éditeur de cartes + générateur.
- **M4 — finition** : fidélité visuelle au mockup, robustesse mobile (reconnexion, changer d'app et revenir, 4G), dockerisation propre (Dockerfile + compose dev/prod). → review finale.

## Tests & qualité (anti-régression)
- Tests unitaires sur la logique pure : agrégation Démocratie (majorité + égalité), file Chaos, déplacement/virage en file, tunnels, collisions, collecte de baguettes, transitions de niveau, vies, **validation/génération de cartes** (connexité, couloirs 1 case, salle présente).
- Garder la logique de jeu **pure et testable** (sans I/O), séparée du transport WebSocket.
- `npm test` doit passer avant chaque commit de fin de jalon.

## Commandes (à implémenter)
- Dev : `docker compose -f docker-compose.dev.yml up` (hot reload, port exposé pour test depuis l'IP du serveur).
- Test : `npm test`.
- Build : `npm run build`. Prod : `docker compose up -d`.

## Définition de « terminé »
Voir §14 du cahier (`docs/cahier-des-specifications.md`). Ne pas cocher un critère tant qu'il n'est pas réellement vérifié (test ou démo).
