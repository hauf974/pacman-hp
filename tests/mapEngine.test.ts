import * as fs from 'fs';
import * as path from 'path';
import {
  makeRng,
  createEmptyMap,
  validateMap,
  generateMap,
  countWideBlocks,
  reachableCount,
  deriveTunnels,
  CORRIDOR,
  WALL,
  ROOM,
  AVATAR,
  SPAWN,
} from '../src/server/mapEngine';
import { MapData, CellType } from '../src/shared/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function loadPacman(): MapData {
  const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'maps', 'pacman.json'), 'utf-8');
  return JSON.parse(raw) as MapData;
}

function clone(map: MapData): MapData {
  return JSON.parse(JSON.stringify(map)) as MapData;
}

// ─── Seeded PRNG ───────────────────────────────────────────────────────────────

describe('makeRng', () => {
  test('is deterministic for a given seed', () => {
    const a = makeRng(123);
    const b = makeRng(123);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  test('different seeds give different sequences', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a()).not.toBe(b());
  });

  test('output is in [0, 1)', () => {
    const r = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ─── createEmptyMap ─────────────────────────────────────────────────────────────

describe('createEmptyMap', () => {
  test('produces border walls and corridor interior', () => {
    const m = createEmptyMap(13, 11);
    expect(m.width).toBe(13);
    expect(m.height).toBe(11);
    // Corners are walls
    expect(m.cells[0][0]).toBe(WALL);
    expect(m.cells[10][12]).toBe(WALL);
    // Interior is corridor
    expect(m.cells[5][6]).toBe(CORRIDOR);
    // No markers yet
    expect(m.pursuerSpawns).toHaveLength(0);
    expect(m.room).toHaveLength(0);
  });
});

// ─── deriveTunnels ──────────────────────────────────────────────────────────────

describe('deriveTunnels', () => {
  test('detects horizontal tunnel from open left/right border', () => {
    const cells: CellType[][] = [
      [1, 1, 1],
      [0, 0, 0],
      [1, 1, 1],
    ];
    expect(deriveTunnels(cells)).toEqual({ horizontal: [1], vertical: [] });
  });

  test('detects vertical tunnel from open top/bottom border', () => {
    const cells: CellType[][] = [
      [1, 0, 1],
      [1, 0, 1],
      [1, 0, 1],
    ];
    expect(deriveTunnels(cells)).toEqual({ horizontal: [], vertical: [1] });
  });

  test('no tunnels on a fully sealed border', () => {
    const cells: CellType[][] = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ];
    expect(deriveTunnels(cells)).toEqual({ horizontal: [], vertical: [] });
  });
});

// ─── countWideBlocks ────────────────────────────────────────────────────────────

describe('countWideBlocks', () => {
  test('flags an open 2×2 corridor block', () => {
    const cells: CellType[][] = [
      [0, 0],
      [0, 0],
    ];
    expect(countWideBlocks(cells)).toBe(1);
  });

  test('does not flag a 1-wide corridor', () => {
    const cells: CellType[][] = [
      [0, 1],
      [0, 1],
    ];
    expect(countWideBlocks(cells)).toBe(0);
  });

  test('does not flag a 2×2 entirely inside the room', () => {
    const cells: CellType[][] = [
      [2, 2],
      [2, 2],
    ];
    expect(countWideBlocks(cells)).toBe(0);
  });

  test('flags a mixed corridor/room open block (corridor widened at room edge)', () => {
    const cells: CellType[][] = [
      [0, 2],
      [0, 2],
    ];
    expect(countWideBlocks(cells)).toBe(1);
  });
});

// ─── reachableCount (tunnel-aware) ──────────────────────────────────────────────

describe('reachableCount', () => {
  function tinyMap(cells: CellType[][], tunnels = { horizontal: [] as number[], vertical: [] as number[] }): MapData {
    return {
      name: 't', width: cells[0].length, height: cells.length, cells,
      avatarStart: { r: 0, c: 0 }, pursuerSpawns: [], room: [], tunnels,
    };
  }

  test('all corridors reachable in a connected line', () => {
    const m = tinyMap([[0, 0, 0, 0]]);
    const { reachable, total } = reachableCount(m);
    expect(reachable).toBe(total);
    expect(total).toBe(4);
  });

  test('isolated pocket is unreachable', () => {
    // (0,0)-(0,1) connected; (0,3) isolated by a wall at (0,2)
    const m = tinyMap([[0, 0, 1, 0]]);
    m.avatarStart = { r: 0, c: 0 };
    const { reachable, total } = reachableCount(m);
    expect(total).toBe(3);
    expect(reachable).toBe(2);
  });

  test('tunnel reconnects the two ends', () => {
    const m = tinyMap([[0, 1, 0]], { horizontal: [0], vertical: [] });
    m.avatarStart = { r: 0, c: 0 };
    const { reachable, total } = reachableCount(m);
    // (0,0) wraps to (0,2) through the tunnel → both reachable
    expect(reachable).toBe(total);
    expect(total).toBe(2);
  });
});

// ─── validateMap ────────────────────────────────────────────────────────────────

describe('validateMap — the shipped default map', () => {
  test('pacman.json is valid', () => {
    const v = validateMap(loadPacman());
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
  });
});

describe('validateMap — rule violations', () => {
  test('missing room is rejected', () => {
    const m = clone(loadPacman());
    for (let r = 0; r < m.height; r++)
      for (let c = 0; c < m.width; c++)
        if (m.cells[r][c] === ROOM) m.cells[r][c] = WALL;
    m.room = [];
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /Salle/i.test(e))).toBe(true);
  });

  test('missing avatar start is rejected', () => {
    const m = clone(loadPacman());
    for (let r = 0; r < m.height; r++)
      for (let c = 0; c < m.width; c++)
        if (m.cells[r][c] === AVATAR) m.cells[r][c] = CORRIDOR;
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /départ avatar/i.test(e))).toBe(true);
  });

  test('two avatar starts are rejected', () => {
    const m = clone(loadPacman());
    // add a second avatar marker on an existing corridor
    outer: for (let r = 1; r < m.height - 1; r++)
      for (let c = 1; c < m.width - 1; c++)
        if (m.cells[r][c] === CORRIDOR) { m.cells[r][c] = AVATAR; break outer; }
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /Plusieurs départs/i.test(e))).toBe(true);
  });

  test('zero spawns is rejected', () => {
    const m = clone(loadPacman());
    for (let r = 0; r < m.height; r++)
      for (let c = 0; c < m.width; c++)
        if (m.cells[r][c] === SPAWN) m.cells[r][c] = CORRIDOR;
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /poursuivant/i.test(e))).toBe(true);
  });

  test('more than 5 spawns is rejected', () => {
    const m = clone(loadPacman());
    let added = 0;
    for (let r = 1; r < m.height - 1 && added < 2; r++)
      for (let c = 1; c < m.width - 1 && added < 2; c++)
        if (m.cells[r][c] === CORRIDOR) { m.cells[r][c] = SPAWN; added++; }
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /5 maximum/i.test(e))).toBe(true);
  });

  test('open border off-tunnel is rejected (contour)', () => {
    const m = clone(loadPacman());
    // Open a left-border cell on a row that is not a tunnel row
    const row = 3; // pacman tunnels are on row 11 only
    m.cells[row][0] = CORRIDOR;
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /Contour/i.test(e))).toBe(true);
  });

  test('open 2×2 block is rejected (wide corridor)', () => {
    const m = clone(loadPacman());
    // Force an open 2×2 in the interior, away from the room
    const r = 2;
    const c = 2;
    m.cells[r][c] = CORRIDOR;
    m.cells[r][c + 1] = CORRIDOR;
    m.cells[r + 1][c] = CORRIDOR;
    m.cells[r + 1][c + 1] = CORRIDOR;
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /Couloir trop large/i.test(e))).toBe(true);
  });

  test('disconnected corridors are rejected (connectivity)', () => {
    const m = clone(loadPacman());
    // Find a wall cell whose 4 orthogonal neighbours are all walls, open it → isolated
    let done = false;
    for (let r = 2; r < m.height - 2 && !done; r++) {
      for (let c = 2; c < m.width - 2 && !done; c++) {
        if (
          m.cells[r][c] === WALL &&
          m.cells[r - 1][c] === WALL && m.cells[r + 1][c] === WALL &&
          m.cells[r][c - 1] === WALL && m.cells[r][c + 1] === WALL
        ) {
          m.cells[r][c] = CORRIDOR;
          done = true;
        }
      }
    }
    expect(done).toBe(true); // sanity: we did create an isolated cell
    const v = validateMap(m);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => /connexes/i.test(e))).toBe(true);
  });
});

// ─── generateMap ────────────────────────────────────────────────────────────────

describe('generateMap', () => {
  test('produces a valid map at the default 23×23', () => {
    const res = generateMap({ width: 23, height: 23, density: 0.4, spawnCount: 5, seed: 1 });
    expect(res.ok).toBe(true);
    expect(res.map).toBeDefined();
    const v = validateMap(res.map!);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
  });

  test('is deterministic for a fixed seed', () => {
    const a = generateMap({ width: 21, height: 21, density: 0.4, spawnCount: 4, seed: 7 });
    const b = generateMap({ width: 21, height: 21, density: 0.4, spawnCount: 4, seed: 7 });
    expect(a.ok && b.ok).toBe(true);
    expect(JSON.stringify(a.map!.cells)).toBe(JSON.stringify(b.map!.cells));
  });

  test('generated map has exactly one avatar and the requested spawns (large grid)', () => {
    const res = generateMap({ width: 23, height: 23, density: 0.4, spawnCount: 5, seed: 3 });
    expect(res.ok).toBe(true);
    const cells = res.map!.cells;
    const count = (t: CellType) => cells.flat().filter(v => v === t).length;
    expect(count(AVATAR)).toBe(1);
    expect(count(SPAWN)).toBe(5);
    expect(count(ROOM)).toBeGreaterThanOrEqual(1);
  });

  test('respects the no-open-2×2 rule (outside room)', () => {
    const res = generateMap({ width: 23, height: 23, density: 0.4, spawnCount: 3, seed: 11 });
    expect(res.ok).toBe(true);
    expect(countWideBlocks(res.map!.cells)).toBe(0);
  });

  test('all corridors are connected (tunnel-aware)', () => {
    const res = generateMap({ width: 23, height: 23, density: 0.4, spawnCount: 5, seed: 5 });
    expect(res.ok).toBe(true);
    const { reachable, total } = reachableCount(res.map!);
    expect(reachable).toBe(total);
  });

  test('works across several odd sizes', () => {
    for (const size of [11, 15, 19, 23, 29]) {
      const res = generateMap({ width: size, height: size, density: 0.4, spawnCount: 2, seed: 9 });
      expect(res.ok).toBe(true);
      expect(validateMap(res.map!).valid).toBe(true);
    }
  });

  test('spawnCount is clamped into 1–5', () => {
    const res = generateMap({ width: 23, height: 23, density: 0.4, spawnCount: 99, seed: 2 });
    expect(res.ok).toBe(true);
    const spawns = res.map!.cells.flat().filter(v => v === SPAWN).length;
    expect(spawns).toBeGreaterThanOrEqual(1);
    expect(spawns).toBeLessThanOrEqual(5);
  });

  test('a freshly generated map declares tunnels with both ends open', () => {
    const res = generateMap({ width: 23, height: 23, density: 0.4, spawnCount: 4, seed: 4 });
    expect(res.ok).toBe(true);
    const m = res.map!;
    expect(m.tunnels.horizontal.length + m.tunnels.vertical.length).toBeGreaterThan(0);
    for (const r of m.tunnels.horizontal) {
      expect([CORRIDOR, ROOM, AVATAR, SPAWN]).toContain(m.cells[r][0]);
      expect([CORRIDOR, ROOM, AVATAR, SPAWN]).toContain(m.cells[r][m.width - 1]);
    }
  });
});
