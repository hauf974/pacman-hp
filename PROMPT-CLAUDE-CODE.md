# Prompt de démarrage — Claude Code

Copier-coller ce prompt dans Claude Code, ouvert à la racine `/home/hauf/pachp.ltn.re`.

---

Tu construis le jeu décrit dans `CLAUDE.md` et `docs/cahier-des-specifications.md` (v1.1). Lis-les en entier d'abord.

**Modèle conseillé** : Sonnet par défaut. Bascule sur Opus pour l'architecture initiale, la logique d'agrégation des votes / file chaos / générateur de cartes, et les revues de fin de jalon. Haiku pour le mécanique/répétitif.

**Méthode** : avance par jalons verticaux M1→M4 (voir CLAUDE.md). À chaque jalon :
1. Écris/maj les tests de la logique pure concernée AVANT ou EN MÊME TEMPS que le code.
2. Implémente. Garde la logique de jeu séparée du transport WebSocket.
3. `npm test` doit passer. Commit git avec un message clair `feat(Mx): ...`.
4. À la fin d'un jalon, fais un court récap de ce qui est fait/testé.

**Commence par M1** :
- Scaffolding TypeScript (package.json, tsconfig, structure src/server, src/shared, src/client/{screen,play,admin}).
- Serveur Node + WebSocket. État de jeu minimal en mémoire.
- `/screen` : rend la carte `data/maps/pacman.json` (statique) en Canvas, plein écran 1920×1080.
- `/play` : page pseudo → manette 4 boutons qui envoie `player:input`.
- `/admin` : bouton lancer/reset + liste des joueurs connectés.
- `docker-compose.dev.yml` qui expose un port sur l'IP du serveur de dev pour test mobile.
- Vérifie que ça tourne sur le port exposé, puis demande une revue à Arnaud avant M2.

Ne passe pas au jalon suivant sans que le précédent soit testé et committé.
