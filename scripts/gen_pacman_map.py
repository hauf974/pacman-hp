#!/usr/bin/env python3
"""Genere la carte par defaut 'pacman' 23x23.
- Mur de contour sur tout le pourtour ; ouvertures de tunnel explicites.
- Labyrinthage a l'interieur (rows 1..H-2, cols 1..W-2).
- Salle sur Demande centrale avec porte UNIQUE (case (10,11)).
- Tunnels wraparound : horizontal row 11, vertical col 11.
Cellules: 0=couloir 1=mur 2=salle 3=depart avatar 4=spawn poursuivant."""
import json, random
from collections import deque

W = H = 23
WALL, PATH, ROOM, AVATAR, SPAWN = 1, 0, 2, 3, 4

# Room position
ROOM_R1, ROOM_R2 = 11, 12   # inclusive
ROOM_C1, ROOM_C2 = 9, 13    # inclusive
# Single door cell (corridor cell just above the room centre)
DOOR_R, DOOR_C = 10, 11
# Tunnel axes
TUNNEL_ROW = 11
TUNNEL_COL = 11


def carve(seed: int):
    random.seed(seed)
    g = [[WALL] * W for _ in range(H)]

    # Interior maze using recursive backtracker.
    # Maze cells sit at (1 + nr*2, 1 + nc*2); NR=NC=11 for H=W=23.
    NR = NC = (H - 2 + 1) // 2  # 11
    vis = [[False] * NC for _ in range(NR)]

    def cell(nr, nc):
        return (1 + nr * 2, 1 + nc * 2)

    vis[0][0] = True
    g[1][1] = PATH
    stack = [(0, 0)]
    while stack:
        nr, nc = stack[-1]
        nb = [(nr + dr, nc + dc, dr, dc)
              for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
              if 0 <= nr + dr < NR and 0 <= nc + dc < NC and not vis[nr + dr][nc + dc]]
        if nb:
            ar, ac, dr, dc = random.choice(nb)
            vis[ar][ac] = True
            r1, c1 = cell(nr, nc)
            r2, c2 = cell(ar, ac)
            g[(r1 + r2) // 2][(c1 + c2) // 2] = PATH
            g[r2][c2] = PATH
            stack.append((ar, ac))
        else:
            stack.pop()

    # Braid: remove ~60 % of dead-ends to create Pac-Man-style loops
    for r in range(1, H - 1):
        for c in range(1, W - 1):
            if g[r][c] == PATH:
                neighbors_path = sum(
                    1 for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                    if 1 <= r + dr <= H - 2 and 1 <= c + dc <= W - 2
                    and g[r + dr][c + dc] == PATH
                )
                if neighbors_path == 1 and random.random() < 0.6:
                    cands = [
                        (r + dr, c + dc)
                        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                        if 1 <= r + 2 * dr <= H - 2 and 1 <= c + 2 * dc <= W - 2
                        and g[r + dr][c + dc] == WALL and g[r + 2 * dr][c + 2 * dc] == PATH
                    ]
                    if cands:
                        wr, wc = random.choice(cands)
                        g[wr][wc] = PATH

    # ── Room ──────────────────────────────────────────────────────────────────
    for r in range(ROOM_R1, ROOM_R2 + 1):
        for c in range(ROOM_C1, ROOM_C2 + 1):
            g[r][c] = ROOM

    # Seal every cell adjacent to the room (outside) with WALL
    for r in range(ROOM_R1, ROOM_R2 + 1):
        for c in range(ROOM_C1, ROOM_C2 + 1):
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nr, nc = r + dr, c + dc
                if 1 <= nr <= H - 2 and 1 <= nc <= W - 2 and g[nr][nc] != ROOM:
                    g[nr][nc] = WALL

    # Open the single door above the room centre
    g[DOOR_R][DOOR_C] = PATH
    # Guarantee connectivity: carve upward from door until we hit a maze PATH
    r_up = DOOR_R - 1
    while r_up >= 1 and g[r_up][DOOR_C] == WALL:
        g[r_up][DOOR_C] = PATH
        r_up -= 1

    # ── Tunnel openings ───────────────────────────────────────────────────────
    # Horizontal tunnel — border openings + first interior cell
    g[TUNNEL_ROW][0] = PATH
    g[TUNNEL_ROW][W - 1] = PATH
    g[TUNNEL_ROW][1] = PATH
    g[TUNNEL_ROW][W - 2] = PATH

    # Vertical tunnel — border openings + first interior cell
    g[0][TUNNEL_COL] = PATH
    g[H - 1][TUNNEL_COL] = PATH
    g[1][TUNNEL_COL] = PATH
    g[H - 2][TUNNEL_COL] = PATH

    return g


def passable(v):
    return v in (PATH, ROOM, AVATAR, SPAWN)


def neighbors_wrap(r, c):
    """Wrap-around neighbors for connectivity check (mirrors tunnel logic)."""
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        yield (r + dr) % H, (c + dc) % W


def connected(g) -> bool:
    start = next(
        ((r, c) for r in range(H) for c in range(W) if passable(g[r][c])), None
    )
    if start is None:
        return False
    seen = {start}
    q = deque([start])
    while q:
        r, c = q.popleft()
        for nr, nc in neighbors_wrap(r, c):
            if passable(g[nr][nc]) and (nr, nc) not in seen:
                seen.add((nr, nc))
                q.append((nr, nc))
    total = sum(1 for r in range(H) for c in range(W) if passable(g[r][c]))
    return len(seen) == total


def is_interior(r, c):
    """True if cell is not on the border row/col (excludes tunnel exit cells)."""
    return 1 <= r <= H - 2 and 1 <= c <= W - 2


def place_markers(g):
    # Avatar start: bottommost INTERIOR corridor, closest to column centre
    av = None
    for r in range(H - 2, 0, -1):
        for c in sorted(range(1, W - 1), key=lambda x: abs(x - W // 2)):
            if g[r][c] == PATH:
                av = (r, c)
                break
        if av:
            break
    g[av[0]][av[1]] = AVATAR

    # Door cell must stay PATH (not overwritten by a spawn)
    door = (DOOR_R, DOOR_C)

    # 5 pursuer spawns: interior cells, near room centre, well spread, not on door
    center = (ROOM_R1 + (ROOM_R2 - ROOM_R1) // 2, ROOM_C1 + (ROOM_C2 - ROOM_C1) // 2)
    cands = sorted(
        [(r, c) for r in range(1, H - 1) for c in range(1, W - 1)
         if g[r][c] == PATH
         and (r, c) != door
         and abs(r - DOOR_R) + abs(c - DOOR_C) >= 3],
        key=lambda p: abs(p[0] - center[0]) + abs(p[1] - center[1])
    )
    spawns = []
    for p in cands:
        if all(abs(p[0] - s[0]) + abs(p[1] - s[1]) >= 4 for s in spawns):
            spawns.append(p)
        if len(spawns) == 5:
            break
    for r, c in spawns:
        g[r][c] = SPAWN
    return av, spawns


def main():
    for seed in range(1, 1000):
        g = carve(seed)
        if not connected(g):
            continue
        av, spawns = place_markers(g)
        if not connected(g):
            continue
        out = {
            "name": "pacman",
            "width": W,
            "height": H,
            "cells": g,
            "avatarStart": {"r": av[0], "c": av[1]},
            "pursuerSpawns": [{"r": r, "c": c} for r, c in spawns],
            "room": [{"r": r, "c": c}
                     for r in range(ROOM_R1, ROOM_R2 + 1)
                     for c in range(ROOM_C1, ROOM_C2 + 1)],
            "roomDoor": {"r": DOOR_R, "c": DOOR_C},
            "tunnels": {"horizontal": [TUNNEL_ROW], "vertical": [TUNNEL_COL]},
            "note": "Carte generee M2.5 : contour mur, tunnel row11/col11, porte unique (10,11).",
            "seed": seed
        }
        with open("data/maps/pacman.json", "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)

        sym = {WALL: "#", PATH: " ", ROOM: "S", AVATAR: "@", SPAWN: "x"}
        print(f"OK seed={seed}  avatar={av}  spawns={spawns}  door=({DOOR_R},{DOOR_C})")
        for row in g:
            print("".join(sym[v] for v in row))
        return
    print("ECHEC: aucune carte valide trouvee")


main()
