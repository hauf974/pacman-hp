#!/usr/bin/env python3
"""Genere la carte par defaut 'pacman' 23x23 : labyrinthe a boucles (style Pac-Man),
couloirs 1 case, salle sur demande centrale, tunnels wraparound H et V.
Cellules: 0=couloir 1=mur 2=salle 3=depart avatar 4=spawn poursuivant."""
import json, random
from collections import deque
W = H = 23
WALL, PATH, ROOM, AVATAR, SPAWN = 1, 0, 2, 3, 4
NR, NC = (H + 1) // 2, (W + 1) // 2

def inb(r, c): return 0 <= r < H and 0 <= c < W

def carve(seed):
    random.seed(seed)
    g = [[WALL] * W for _ in range(H)]
    vis = [[False] * NC for _ in range(NR)]
    def cell(nr, nc): return (nr * 2, nc * 2)
    stack = [(0, 0)]; vis[0][0] = True; g[0][0] = PATH
    while stack:
        nr, nc = stack[-1]
        nb = [(nr+dr, nc+dc, dr, dc) for dr, dc in ((1,0),(-1,0),(0,1),(0,-1))
              if 0 <= nr+dr < NR and 0 <= nc+dc < NC and not vis[nr+dr][nc+dc]]
        if nb:
            ar, ac, dr, dc = random.choice(nb); vis[ar][ac] = True
            r1, c1 = cell(nr, nc); r2, c2 = cell(ar, ac)
            g[(r1+r2)//2][(c1+c2)//2] = PATH; g[r2][c2] = PATH
            stack.append((ar, ac))
        else:
            stack.pop()
    # Braid : retire des culs-de-sac pour creer des boucles (feeling Pac-Man)
    for r in range(H):
        for c in range(W):
            if g[r][c] == PATH:
                pn = sum(1 for dr,dc in ((1,0),(-1,0),(0,1),(0,-1))
                         if inb(r+dr,c+dc) and g[r+dr][c+dc]==PATH)
                if pn == 1 and random.random() < 0.6:
                    cand = [(r+dr,c+dc) for dr,dc in ((1,0),(-1,0),(0,1),(0,-1))
                            if inb(r+2*dr,c+2*dc) and g[r+dr][c+dc]==WALL and g[r+2*dr][c+2*dc]==PATH]
                    if cand:
                        wr, wc = random.choice(cand); g[wr][wc] = PATH
    # Salle sur demande centrale (rectangle 2x5) + connexions garanties
    for r in range(11, 13):
        for c in range(9, 14):
            g[r][c] = ROOM
    for (r, c) in [(10,11),(13,11),(10,9),(10,13),(13,9),(13,13)]:
        g[r][c] = PATH
        if inb(r-1,c) and r==10: g[r-1][c]=PATH
        if inb(r+1,c) and r==13: g[r+1][c]=PATH
    # Tunnels wraparound : horizontal (ligne 10) et vertical (colonne 10)
    for (r, c) in [(10,0),(10,1),(10,21),(10,22),(0,10),(1,10),(21,10),(22,10)]:
        g[r][c] = PATH
    return g

def passable(v): return v in (PATH, ROOM, AVATAR, SPAWN)

def neighbors(r, c):
    for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
        yield ((r+dr) % H, (c+dc) % W)  # wraparound H et V

def connected(g):
    # toutes les cases passables joignables depuis une seule composante
    start = next(((r,c) for r in range(H) for c in range(W) if passable(g[r][c])), None)
    seen = set([start]); q = deque([start])
    while q:
        r, c = q.popleft()
        for nr, nc in neighbors(r, c):
            if passable(g[nr][nc]) and (nr,nc) not in seen:
                seen.add((nr,nc)); q.append((nr,nc))
    total = sum(1 for r in range(H) for c in range(W) if passable(g[r][c]))
    return len(seen) == total

def place_markers(g):
    # depart avatar : couloir le plus proche du bas-centre
    av = None
    for r in range(H-1, -1, -1):
        for c in sorted(range(W), key=lambda x: abs(x-11)):
            if g[r][c] == PATH:
                av = (r, c); break
        if av: break
    g[av[0]][av[1]] = AVATAR
    # 5 spawns poursuivants : couloirs proches du centre (hors salle), bien repartis
    center = (11, 11)
    cands = sorted([(r,c) for r in range(H) for c in range(W) if g[r][c]==PATH],
                   key=lambda p: abs(p[0]-center[0])+abs(p[1]-center[1]))
    spawns = []
    for p in cands:
        if all(abs(p[0]-s[0])+abs(p[1]-s[1]) >= 3 for s in spawns):
            spawns.append(p)
        if len(spawns) == 5: break
    for (r, c) in spawns:
        g[r][c] = SPAWN
    return av, spawns

def main():
    for seed in range(1, 500):
        g = carve(seed)
        if not connected(g):
            continue
        av, spawns = place_markers(g)
        if not connected(g):
            continue
        out = {
            "name": "pacman",
            "width": W, "height": H,
            "cells": g,
            "avatarStart": {"r": av[0], "c": av[1]},
            "pursuerSpawns": [{"r": r, "c": c} for (r, c) in spawns],
            "room": [{"r": r, "c": c} for r in range(11,13) for c in range(9,14)],
            "tunnels": {"horizontal": [10], "vertical": [10]},
            "note": "Carte de depart generee (style Pac-Man, editable dans l'admin). A affiner vs docs/map-concept.png si besoin.",
            "seed": seed
        }
        with open("data/maps/pacman.json", "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        # apercu ASCII
        sym = {WALL:"#", PATH:" ", ROOM:"S", AVATAR:"@", SPAWN:"x"}
        print(f"OK seed={seed}  avatar={av}  spawns={spawns}")
        for row in g:
            print("".join(sym[v] for v in row))
        return
    print("ECHEC: aucune carte valide")

main()
