import { MapData, CellType, Direction, MapGenParams, MapValidation } from '../shared/types';
import { isWalkable, canMove, moveEntity } from './gameEngine';

// Cell codes: 0=corridor 1=wall 2=room 3=avatar-start 4=pursuer-spawn
export const CORRIDOR: CellType = 0;
export const WALL: CellType = 1;
export const ROOM: CellType = 2;
export const AVATAR: CellType = 3;
export const SPAWN: CellType = 4;

const PASSABLE: ReadonlySet<CellType> = new Set<CellType>([0, 2, 3, 4]);
const DIRS: Direction[] = ['up', 'down', 'left', 'right'];

export const MIN_SIZE = 11;
export const MAX_SIZE = 41;

// ─── Seeded PRNG (mulberry32) — makes generation deterministic & testable ─────
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ─── Empty grid: corridor interior, wall border, no markers/tunnels ───────────
export function createEmptyMap(width: number, height: number, name = 'nouvelle-carte'): MapData {
  const cells: CellType[][] = [];
  for (let r = 0; r < height; r++) {
    const row: CellType[] = [];
    for (let c = 0; c < width; c++) {
      const border = r === 0 || r === height - 1 || c === 0 || c === width - 1;
      row.push(border ? WALL : CORRIDOR);
    }
    cells.push(row);
  }
  return {
    name,
    width,
    height,
    cells,
    avatarStart: { r: 1, c: 1 },
    pursuerSpawns: [],
    room: [],
    tunnels: { horizontal: [], vertical: [] },
  };
}

// ─── Helpers shared by validation & generation ────────────────────────────────
function passAt(cells: CellType[][], r: number, c: number, H: number, W: number): boolean {
  return r >= 0 && r < H && c >= 0 && c < W && PASSABLE.has(cells[r][c]);
}

function countCells(cells: CellType[][], type: CellType): number {
  let n = 0;
  for (const row of cells) for (const v of row) if (v === type) n++;
  return n;
}

/** Derive the {horizontal, vertical} tunnel axes from open border cells. */
export function deriveTunnels(cells: CellType[][]): { horizontal: number[]; vertical: number[] } {
  const H = cells.length;
  const W = cells[0].length;
  const horizontal: number[] = [];
  const vertical: number[] = [];
  for (let r = 0; r < H; r++) {
    if (PASSABLE.has(cells[r][0]) || PASSABLE.has(cells[r][W - 1])) horizontal.push(r);
  }
  for (let c = 0; c < W; c++) {
    if (PASSABLE.has(cells[0][c]) || PASSABLE.has(cells[H - 1][c])) vertical.push(c);
  }
  return { horizontal, vertical };
}

/**
 * Count passable cells reachable from the avatar start (or first passable cell),
 * traversing exactly the way the game moves (respects tunnels via canMove/moveEntity).
 */
export function reachableCount(map: MapData): { reachable: number; total: number } {
  const { cells, width: W, height: H } = map;
  const passable: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (isWalkable(map, r, c)) passable.push({ r, c });
  const total = passable.length;
  if (total === 0) return { reachable: 0, total: 0 };

  const start = isWalkable(map, map.avatarStart.r, map.avatarStart.c)
    ? map.avatarStart
    : passable[0];
  const visited = new Set<string>([`${start.r},${start.c}`]);
  const queue: Array<{ r: number; c: number }> = [start];
  while (queue.length > 0) {
    const { r, c } = queue.shift()!;
    for (const dir of DIRS) {
      if (canMove(map, r, c, dir)) {
        const n = moveEntity(map, r, c, dir);
        const key = `${n.r},${n.c}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push(n);
        }
      }
    }
  }
  return { reachable: visited.size, total };
}

/** Count open 2×2 blocks (all four passable) that are NOT entirely inside the room. */
export function countWideBlocks(cells: CellType[][]): number {
  const H = cells.length;
  const W = cells[0].length;
  let n = 0;
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const quad = [cells[r][c], cells[r][c + 1], cells[r + 1][c], cells[r + 1][c + 1]];
      const allPass = quad.every(v => PASSABLE.has(v));
      const allRoom = quad.every(v => v === ROOM);
      if (allPass && !allRoom) n++;
    }
  }
  return n;
}

// ─── Validation ───────────────────────────────────────────────────────────────
export function validateMap(map: MapData): MapValidation {
  const errors: string[] = [];
  const cells = map.cells;
  const H = map.height;
  const W = map.width;

  // Structural sanity
  if (W < MIN_SIZE || W > MAX_SIZE || H < MIN_SIZE || H > MAX_SIZE) {
    errors.push(`Dimensions hors bornes (${MIN_SIZE}×${MIN_SIZE} à ${MAX_SIZE}×${MAX_SIZE}).`);
  }
  if (cells.length !== H || cells.some(row => row.length !== W)) {
    errors.push('La grille ne correspond pas aux dimensions déclarées.');
    return { valid: false, errors };
  }

  // Room + door
  const roomCount = countCells(cells, ROOM);
  if (roomCount < 1) {
    errors.push('Aucune Salle sur Demande (placez une pièce).');
  }
  const door = map.roomDoor;
  if (!door) {
    errors.push('Aucune porte de Salle (roomDoor manquante).');
  } else {
    const onGrid = door.r >= 0 && door.r < H && door.c >= 0 && door.c < W;
    if (!onGrid || !PASSABLE.has(cells[door.r][door.c]) || cells[door.r][door.c] === ROOM) {
      errors.push('La porte doit être une case couloir accessible.');
    } else {
      const touchesRoom = DIRS.some(d => {
        const { dr, dc } = { up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 }, left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 } }[d];
        const nr = door.r + dr;
        const nc = door.c + dc;
        return nr >= 0 && nr < H && nc >= 0 && nc < W && cells[nr][nc] === ROOM;
      });
      if (roomCount >= 1 && !touchesRoom) {
        errors.push('La porte doit être adjacente à la Salle.');
      }
    }
  }

  // Avatar start — exactly one
  const avatarCount = countCells(cells, AVATAR);
  if (avatarCount === 0) errors.push('Aucun départ avatar.');
  else if (avatarCount > 1) errors.push(`Plusieurs départs avatar (${avatarCount}), un seul autorisé.`);

  // Pursuer spawns — between 1 and 5
  const spawnCount = countCells(cells, SPAWN);
  if (spawnCount < 1) errors.push('Aucune apparition de poursuivant (≥ 1 requise).');
  else if (spawnCount > 5) errors.push(`Trop d'apparitions de poursuivants (${spawnCount}), 5 maximum.`);

  // Closed contour except declared tunnels (both opposite ends must be open)
  const tunH = new Set(map.tunnels?.horizontal ?? []);
  const tunV = new Set(map.tunnels?.vertical ?? []);
  let contourBad = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const onBorder = r === 0 || r === H - 1 || c === 0 || c === W - 1;
      if (!onBorder || !PASSABLE.has(cells[r][c])) continue;
      const lrTunnel = (c === 0 || c === W - 1) && tunH.has(r) && PASSABLE.has(cells[r][0]) && PASSABLE.has(cells[r][W - 1]);
      const tbTunnel = (r === 0 || r === H - 1) && tunV.has(c) && PASSABLE.has(cells[0][c]) && PASSABLE.has(cells[H - 1][c]);
      if (!lrTunnel && !tbTunnel) contourBad++;
    }
  }
  if (contourBad > 0) {
    errors.push(`Contour ouvert hors tunnel (${contourBad} case(s)). Un tunnel exige les deux bords opposés ouverts.`);
  }

  // No corridor wider than 1 cell outside the room
  const wide = countWideBlocks(cells);
  if (wide > 0) {
    errors.push(`Couloir trop large : ${wide} zone(s) ouverte(s) 2×2 hors Salle.`);
  }

  // Connectivity (tunnel-aware), and door/room reachable
  const { reachable, total } = reachableCount(map);
  if (total > 0 && reachable !== total) {
    errors.push(`Couloirs non connexes (${reachable}/${total} cases atteignables).`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Generation (port of scripts/gen_pacman_map.py, generalised) ──────────────

interface CarveResult {
  cells: CellType[][];
  roomDoor: { r: number; c: number };
  tunnels: { horizontal: number[]; vertical: number[] };
}

function carve(rng: () => number, W: number, H: number, density: number, noBraid = false): CarveResult {
  const cells: CellType[][] = Array.from({ length: H }, () => Array<CellType>(W).fill(WALL));

  // Maze cells sit at (1 + nr*2, 1 + nc*2)
  const NR = Math.floor((H - 1) / 2);
  const NC = Math.floor((W - 1) / 2);
  const cell = (nr: number, nc: number): [number, number] => [1 + nr * 2, 1 + nc * 2];

  const vis: boolean[][] = Array.from({ length: NR }, () => Array<boolean>(NC).fill(false));
  vis[0][0] = true;
  cells[1][1] = CORRIDOR;
  const stack: Array<[number, number]> = [[0, 0]];
  const STEPS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length > 0) {
    const [nr, nc] = stack[stack.length - 1];
    const nb = STEPS
      .map(([dr, dc]) => [nr + dr, nc + dc, dr, dc] as [number, number, number, number])
      .filter(([ar, ac]) => ar >= 0 && ar < NR && ac >= 0 && ac < NC && !vis[ar][ac]);
    if (nb.length > 0) {
      const [ar, ac] = pick(rng, nb);
      vis[ar][ac] = true;
      const [r1, c1] = cell(nr, nc);
      const [r2, c2] = cell(ar, ac);
      cells[(r1 + r2) >> 1][(c1 + c2) >> 1] = CORRIDOR;
      cells[r2][c2] = CORRIDOR;
      stack.push([ar, ac]);
    } else {
      stack.pop();
    }
  }

  // Braid: remove a share of dead-ends to create Pac-Man-style loops.
  // braidProb derives from density (more walls ⇒ fewer loops removed).
  const braidProb = Math.max(0.2, Math.min(0.85, 1 - density));
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      if (cells[r][c] !== CORRIDOR) continue;
      const pathNb = STEPS.filter(([dr, dc]) =>
        r + dr >= 1 && r + dr <= H - 2 && c + dc >= 1 && c + dc <= W - 2 && cells[r + dr][c + dc] === CORRIDOR,
      ).length;
      if (pathNb === 1 && rng() < braidProb) {
        const cands = STEPS.filter(([dr, dc]) =>
          r + 2 * dr >= 1 && r + 2 * dr <= H - 2 && c + 2 * dc >= 1 && c + 2 * dc <= W - 2 &&
          cells[r + dr][c + dc] === WALL && cells[r + 2 * dr][c + 2 * dc] === CORRIDOR,
        );
        if (cands.length > 0) {
          const [dr, dc] = pick(rng, cands);
          cells[r + dr][c + dc] = CORRIDOR;
        }
      }
    }
  }

  // Room: 2-row × roomW rectangle centred on an odd door column.
  let doorC = Math.floor(W / 2);
  if (doorC % 2 === 0) doorC -= 1; // align to a maze corridor column
  const roomW = Math.max(3, Math.min(W - 6, doorC % 2 === 1 ? 3 : 3));
  const roomC1 = doorC - Math.floor(roomW / 2);
  const roomC2 = roomC1 + roomW - 1;
  const roomR1 = Math.floor(H / 2);
  const roomR2 = Math.min(H - 2, roomR1 + 1);
  const doorR = roomR1 - 1;

  for (let r = roomR1; r <= roomR2; r++)
    for (let c = roomC1; c <= roomC2; c++) cells[r][c] = ROOM;

  // Seal cells adjacent to the room (outside it) with wall.
  for (let r = roomR1; r <= roomR2; r++) {
    for (let c = roomC1; c <= roomC2; c++) {
      for (const [dr, dc] of STEPS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 1 && nr <= H - 2 && nc >= 1 && nc <= W - 2 && cells[nr][nc] !== ROOM) {
          cells[nr][nc] = WALL;
        }
      }
    }
  }

  // Open the single door above the room centre, carve upward to a maze corridor.
  cells[doorR][doorC] = CORRIDOR;
  let up = doorR - 1;
  while (up >= 1 && cells[up][doorC] === WALL) {
    cells[up][doorC] = CORRIDOR;
    up--;
  }

  // Tunnels — horizontal axis (a maze row) and vertical axis (a maze col != door col).
  let tRow = Math.floor(H / 2);
  if (tRow % 2 === 0) tRow -= 1;
  if (tRow === roomR1 || tRow === roomR2 || tRow === doorR) tRow = Math.max(1, tRow - 2);
  let tCol = Math.floor(W / 2);
  if (tCol % 2 === 0) tCol -= 1;
  if (tCol === doorC) tCol = Math.max(1, tCol - 2);

  cells[tRow][0] = CORRIDOR;
  cells[tRow][1] = CORRIDOR;
  cells[tRow][W - 1] = CORRIDOR;
  cells[tRow][W - 2] = CORRIDOR;
  cells[0][tCol] = CORRIDOR;
  cells[1][tCol] = CORRIDOR;
  cells[H - 1][tCol] = CORRIDOR;
  cells[H - 2][tCol] = CORRIDOR;

  // Full braiding: multi-pass dead-end removal runs after room/door/tunnel so that
  // corridors isolated by room sealing are also resolved.
  if (noBraid) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 1; r < H - 1; r++) {
        for (let c = 1; c < W - 1; c++) {
          if (cells[r][c] !== CORRIDOR) continue;
          const corridorNb = STEPS.filter(([dr, dc]) =>
            r + dr >= 1 && r + dr <= H - 2 && c + dc >= 1 && c + dc <= W - 2 &&
            cells[r + dr][c + dc] === CORRIDOR,
          ).length;
          if (corridorNb === 1) {
            const cands = STEPS.filter(([dr, dc]) =>
              r + 2 * dr >= 1 && r + 2 * dr <= H - 2 && c + 2 * dc >= 1 && c + 2 * dc <= W - 2 &&
              cells[r + dr][c + dc] === WALL && cells[r + 2 * dr][c + 2 * dc] === CORRIDOR,
            );
            if (cands.length > 0) {
              const [dr, dc] = pick(rng, cands);
              cells[r + dr][c + dc] = CORRIDOR;
              changed = true;
            }
          }
        }
      }
    }
  }

  return { cells, roomDoor: { r: doorR, c: doorC }, tunnels: { horizontal: [tRow], vertical: [tCol] } };
}

function placeMarkers(
  cells: CellType[][],
  H: number,
  W: number,
  door: { r: number; c: number },
  spawnCount: number,
): void {
  const centerC = Math.floor(W / 2);

  // Avatar: bottommost interior corridor, column closest to centre.
  let placed = false;
  for (let r = H - 2; r >= 1 && !placed; r--) {
    const cols = Array.from({ length: W - 2 }, (_, i) => i + 1).sort(
      (a, b) => Math.abs(a - centerC) - Math.abs(b - centerC),
    );
    for (const c of cols) {
      if (cells[r][c] === CORRIDOR) {
        cells[r][c] = AVATAR;
        placed = true;
        break;
      }
    }
  }

  // Spawns: interior corridors near the door, spread out; relax spacing if needed.
  const center = { r: door.r + 1, c: door.c };
  const baseCands: Array<{ r: number; c: number }> = [];
  for (let r = 1; r <= H - 2; r++) {
    for (let c = 1; c <= W - 2; c++) {
      if (cells[r][c] === CORRIDOR &&
          !(r === door.r && c === door.c) &&
          Math.abs(r - door.r) + Math.abs(c - door.c) >= 2) {
        baseCands.push({ r, c });
      }
    }
  }
  baseCands.sort(
    (a, b) =>
      Math.abs(a.r - center.r) + Math.abs(a.c - center.c) -
      (Math.abs(b.r - center.r) + Math.abs(b.c - center.c)),
  );

  for (let minDist = 4; minDist >= 0; minDist--) {
    const spawns: Array<{ r: number; c: number }> = [];
    for (const p of baseCands) {
      if (spawns.every(s => Math.abs(p.r - s.r) + Math.abs(p.c - s.c) >= minDist)) {
        spawns.push(p);
      }
      if (spawns.length === spawnCount) break;
    }
    if (spawns.length === spawnCount) {
      for (const s of spawns) cells[s.r][s.c] = SPAWN;
      return;
    }
  }
  // Fallback: place whatever we can find.
  let n = 0;
  for (const p of baseCands) {
    if (n >= spawnCount) break;
    cells[p.r][p.c] = SPAWN;
    n++;
  }
}

function assembleMap(
  name: string,
  cells: CellType[][],
  roomDoor: { r: number; c: number },
  tunnels: { horizontal: number[]; vertical: number[] },
): MapData {
  const H = cells.length;
  const W = cells[0].length;
  const room: Array<{ r: number; c: number }> = [];
  const pursuerSpawns: Array<{ r: number; c: number }> = [];
  let avatarStart = { r: 1, c: 1 };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (cells[r][c] === ROOM) room.push({ r, c });
      else if (cells[r][c] === SPAWN) pursuerSpawns.push({ r, c });
      else if (cells[r][c] === AVATAR) avatarStart = { r, c };
    }
  }
  return { name, width: W, height: H, cells, avatarStart, pursuerSpawns, room, roomDoor, tunnels };
}

/**
 * Generate a Pac-Man-style map satisfying validateMap. Tries successive seeds
 * (deterministic from params.seed if given) until a valid layout is found.
 */
export function generateMap(params: MapGenParams): { ok: boolean; map?: MapData; error?: string } {
  const width = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(params.width)));
  const height = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(params.height)));
  const density = Math.max(0.1, Math.min(0.8, params.density));
  const spawnCount = Math.max(1, Math.min(5, Math.round(params.spawnCount)));
  const baseSeed = params.seed !== undefined ? params.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;

  const MAX_ATTEMPTS = 600;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = makeRng((baseSeed + attempt) >>> 0);
    const { cells, roomDoor, tunnels } = carve(rng, width, height, density, params.noBraid ?? false);
    placeMarkers(cells, height, width, roomDoor, spawnCount);
    const map = assembleMap('carte-generee', cells, roomDoor, tunnels);
    const v = validateMap(map);
    if (v.valid) {
      map.seed = (baseSeed + attempt) >>> 0;
      return { ok: true, map };
    }
  }
  return { ok: false, error: `Génération échouée après ${MAX_ATTEMPTS} essais (essayez une autre taille/densité).` };
}
