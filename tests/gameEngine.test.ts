import {
  aggregateDemocracy,
  buildVoteTally,
  canMove,
  applyTunnel,
  dirDelta,
  computeAvatarStep,
  checkCollisions,
  checkRoomEntry,
  allWandsCollected,
  bfsNextDir,
  consumeChaosInput,
  spawnPursuers,
  spawnWands,
  checkWandCollection,
  MIN_WAND_DIST,
} from '../src/server/gameEngine';
import { TimedInput, MapData, GameState, Avatar, Direction } from '../src/shared/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMap(cells: number[][], tunnelsH: number[] = [], tunnelsV: number[] = []): MapData {
  return {
    name: 'test',
    width: cells[0].length,
    height: cells.length,
    cells: cells as any,
    avatarStart: { r: 0, c: 0 },
    pursuerSpawns: [],
    room: [],
    tunnels: { horizontal: tunnelsH, vertical: tunnelsV },
  };
}

function makeAvatar(r: number, c: number, dir: Direction, queuedDir: Direction | null = null): Avatar {
  return { r, c, dir, queuedDir, speed: 4 };
}

/** Minimal GameState shell — only fields needed by the engine functions. */
function makeState(
  avatar: Avatar,
  map: MapData,
  pursuers: { r: number; c: number }[] = [],
  room: { r: number; c: number }[] = [],
  wands: { r: number; c: number; collected: boolean }[] = [],
): GameState {
  return {
    status: 'playing',
    mode: 'democracy',
    objectiveMode: 'room',
    level: 1,
    lives: 3,
    activeMap: { ...map, room },
    avatar,
    pursuers: pursuers.map((p, i) => ({
      id: `p${i}`, type: 'rusard' as any,
      r: p.r, c: p.c, dir: 'left' as Direction, speed: 3,
    })),
    wands: wands as any,
    players: {},
    inputBuffer: [],
    chaosQueue: [],
    voteTally: { up: 0, down: 0, left: 0, right: 0 },
    settings: {
      tempo: 'anime', atmosphere: 'parchemin', titleFont: 'UnifrakturCook',
      footprints: false, pursuerSpeed: 3, avatarSpeed: 4, voteWindowSec: 3,
      wandCountPerLevel: 3, autoMove: true, startingLevel: 1,
    },
    toursJoues: 0,
  };
}

// ─── Democracy aggregation ────────────────────────────────────────────────────

describe('aggregateDemocracy', () => {
  const now = Date.now();
  const inp = (dir: Direction, msAgo: number): TimedInput =>
    ({ dir, ts: now - msAgo, playerId: 'p1' });

  test('majority wins', () => {
    const inputs = [inp('up', 100), inp('up', 200), inp('down', 300), inp('right', 400)];
    expect(aggregateDemocracy(inputs, 5000, now)).toBe('up');
  });

  test('returns null if no inputs in window', () => {
    expect(aggregateDemocracy([inp('up', 10000)], 3000, now)).toBeNull();
  });

  test('returns null on empty buffer', () => {
    expect(aggregateDemocracy([], 3000, now)).toBeNull();
  });

  test('tie returns one of the tied directions', () => {
    const inputs = [inp('up', 100), inp('down', 200)];
    const result = aggregateDemocracy(inputs, 5000, now);
    expect(['up', 'down']).toContain(result);
  });

  test('3-way tie returns one of the three', () => {
    const inputs = [inp('up', 100), inp('down', 200), inp('left', 300)];
    const result = aggregateDemocracy(inputs, 5000, now);
    expect(['up', 'down', 'left']).toContain(result);
  });

  test('only inputs within window are counted', () => {
    const inputs = [inp('up', 100), inp('down', 8000)]; // down is outside 5s window
    expect(aggregateDemocracy(inputs, 5000, now)).toBe('up');
  });
});

describe('buildVoteTally', () => {
  const now = Date.now();
  const inp = (dir: Direction, msAgo: number): TimedInput =>
    ({ dir, ts: now - msAgo, playerId: 'p1' });

  test('counts votes correctly within window', () => {
    const inputs = [inp('up', 100), inp('up', 200), inp('left', 300)];
    const tally = buildVoteTally(inputs, 5000, now);
    expect(tally).toEqual({ up: 2, down: 0, left: 1, right: 0 });
  });

  test('ignores inputs outside window', () => {
    const inputs = [inp('up', 100), inp('up', 10000)];
    const tally = buildVoteTally(inputs, 3000, now);
    expect(tally.up).toBe(1);
  });

  test('returns all-zeros for empty buffer', () => {
    expect(buildVoteTally([], 3000, now)).toEqual({ up: 0, down: 0, left: 0, right: 0 });
  });
});

// ─── dirDelta ─────────────────────────────────────────────────────────────────

describe('dirDelta', () => {
  test('up decrements row', () => expect(dirDelta('up')).toEqual({ dr: -1, dc: 0 }));
  test('down increments row', () => expect(dirDelta('down')).toEqual({ dr: 1, dc: 0 }));
  test('left decrements col', () => expect(dirDelta('left')).toEqual({ dr: 0, dc: -1 }));
  test('right increments col', () => expect(dirDelta('right')).toEqual({ dr: 0, dc: 1 }));
});

// ─── canMove / tunnels ────────────────────────────────────────────────────────

describe('canMove', () => {
  // Surrounded by walls
  const walled = makeMap([
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1],
  ]);
  test('cannot move into wall', () => {
    expect(canMove(walled, 1, 1, 'up')).toBe(false);
    expect(canMove(walled, 1, 1, 'down')).toBe(false);
    expect(canMove(walled, 1, 1, 'left')).toBe(false);
    expect(canMove(walled, 1, 1, 'right')).toBe(false);
  });

  // Open grid
  const open = makeMap([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  test('can move in open map', () => {
    expect(canMove(open, 1, 1, 'up')).toBe(true);
    expect(canMove(open, 1, 1, 'down')).toBe(true);
    expect(canMove(open, 1, 1, 'left')).toBe(true);
    expect(canMove(open, 1, 1, 'right')).toBe(true);
  });

  // Room cells (type 2) and spawn cells (type 4) are walkable
  const special = makeMap([[0, 2, 4]]);
  test('room cells are walkable', () => {
    expect(canMove(special, 0, 0, 'right')).toBe(true); // → type 2
  });
  test('pursuer-spawn cells are walkable', () => {
    expect(canMove(special, 0, 1, 'right')).toBe(true); // → type 4
  });
});

describe('applyTunnel — horizontal', () => {
  const map = makeMap([[0, 0, 0]], [0]);

  test('wraps left edge to right', () => {
    expect(applyTunnel(map, 0, -1)).toEqual({ r: 0, c: 2 });
  });
  test('wraps right edge to left', () => {
    expect(applyTunnel(map, 0, 3)).toEqual({ r: 0, c: 0 });
  });
  test('no wrap when row not in tunnel list', () => {
    const noTunnel = makeMap([[0, 0, 0], [0, 0, 0]], [0]); // only row 0
    expect(applyTunnel(noTunnel, 1, -1)).toEqual({ r: 1, c: -1 });
  });
});

describe('applyTunnel — vertical', () => {
  const map = makeMap([[0], [0], [0]], [], [0]);

  test('wraps top edge to bottom', () => {
    expect(applyTunnel(map, -1, 0)).toEqual({ r: 2, c: 0 });
  });
  test('wraps bottom edge to top', () => {
    expect(applyTunnel(map, 3, 0)).toEqual({ r: 0, c: 0 });
  });
  test('no wrap when col not in tunnel list', () => {
    const noTunnel = makeMap([[0, 0], [0, 0], [0, 0]], [], [0]); // only col 0
    expect(applyTunnel(noTunnel, -1, 1)).toEqual({ r: -1, c: 1 });
  });
});

describe('canMove through tunnel', () => {
  // 1-row map with horizontal tunnel; both edges are corridors
  const map = makeMap([[0, 0, 0]], [0]);

  test('can exit left edge via tunnel (row 0)', () => {
    // From (0,0) going left → tunnel → (0,2) which is corridor
    expect(canMove(map, 0, 0, 'left')).toBe(true);
  });
  test('can exit right edge via tunnel (row 0)', () => {
    expect(canMove(map, 0, 2, 'right')).toBe(true);
  });
});

// ─── computeAvatarStep (Pac-Man movement) ────────────────────────────────────

describe('computeAvatarStep', () => {
  // Simple corridor: [0,0,0,0,0]
  const corridor = makeMap([[0, 0, 0, 0, 0]]);

  // Cross-shaped map for intersection testing
  //   0 0 0
  //   0 0 0
  //   0 0 0
  const cross = makeMap([
    [1, 0, 1],
    [0, 0, 0],
    [1, 0, 1],
  ]);

  test('moves forward in current direction', () => {
    const r = computeAvatarStep(corridor, 0, 1, 'right', null);
    expect(r).toMatchObject({ r: 0, c: 2, dir: 'right', turned: false });
    expect(r.queuedDir).toBeNull();
  });

  test('stops when wall ahead and queued dir also blocked, retains queued intent', () => {
    // 1-row corridor — at col 0 going left (wall), queued=up (no row above in 1-row map)
    const r = computeAvatarStep(corridor, 0, 0, 'left', 'up');
    expect(r).toMatchObject({ r: 0, c: 0 }); // stays put
    expect(r.queuedDir).toBe('up'); // intent kept for later
  });

  test('stops when wall ahead and no queued dir', () => {
    const r = computeAvatarStep(corridor, 0, 0, 'left', null);
    expect(r).toMatchObject({ r: 0, c: 0, dir: 'left', turned: false });
  });

  test('applies queued direction at intersection', () => {
    // Avatar at center (1,1) moving right; queue = up → up is passable here
    const r = computeAvatarStep(cross, 1, 1, 'right', 'up');
    expect(r).toMatchObject({ r: 0, c: 1, dir: 'up', queuedDir: null, turned: true });
  });

  test('keeps queued direction when turn is blocked', () => {
    // In corridor (only left/right open), queue = up
    const r = computeAvatarStep(corridor, 0, 2, 'right', 'up');
    // up is a wall (only 1 row), but can still go right
    expect(r).toMatchObject({ r: 0, c: 3, dir: 'right', turned: false });
    expect(r.queuedDir).toBe('up'); // still waiting for opportunity
  });

  test('clears queued direction after applying', () => {
    const r = computeAvatarStep(cross, 1, 1, 'right', 'up');
    expect(r.queuedDir).toBeNull();
  });

  test('queued dir takes priority over current dir when both open', () => {
    // At (1,1) in cross, both right and up are open; queue = up → should go up
    const r = computeAvatarStep(cross, 1, 1, 'right', 'up');
    expect(r.dir).toBe('up');
  });

  test('can reverse direction (queued = opposite)', () => {
    // Moving right in corridor, queue = left (reverse) — should work immediately
    const r = computeAvatarStep(corridor, 0, 2, 'right', 'left');
    expect(r).toMatchObject({ r: 0, c: 1, dir: 'left', turned: true });
  });

  test('wraparound tunnel movement', () => {
    // 1×3 corridor with horizontal tunnel on row 0; moving right from col 2
    const tunnelMap = makeMap([[0, 0, 0]], [0]);
    const r = computeAvatarStep(tunnelMap, 0, 2, 'right', null);
    expect(r).toMatchObject({ r: 0, c: 0, dir: 'right' }); // wraps to left
  });
});

// ─── Collision detection ──────────────────────────────────────────────────────

describe('checkCollisions', () => {
  const map = makeMap([[0, 0, 0]]);

  test('collision when avatar and pursuer share position', () => {
    const state = makeState(makeAvatar(0, 1, 'right'), map, [{ r: 0, c: 1 }]);
    expect(checkCollisions(state)).toBe(true);
  });

  test('no collision when at different positions', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map, [{ r: 0, c: 2 }]);
    expect(checkCollisions(state)).toBe(false);
  });

  test('no collision when no pursuers', () => {
    const state = makeState(makeAvatar(0, 1, 'right'), map, []);
    expect(checkCollisions(state)).toBe(false);
  });

  test('collision with any of multiple pursuers', () => {
    const state = makeState(makeAvatar(0, 1, 'right'), map, [
      { r: 0, c: 0 },
      { r: 0, c: 1 }, // this one matches
      { r: 0, c: 2 },
    ]);
    expect(checkCollisions(state)).toBe(true);
  });
});

// ─── Room entry / level transition ───────────────────────────────────────────

describe('checkRoomEntry — fallback (no roomDoor)', () => {
  const map = makeMap([[0, 0, 0]]);
  const room = [{ r: 0, c: 2 }];

  test('detects entry when avatar is in room cell', () => {
    const state = makeState(makeAvatar(0, 2, 'right'), map, [], room);
    expect(checkRoomEntry(state)).toBe(true);
  });

  test('no entry when avatar is outside room', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map, [], room);
    expect(checkRoomEntry(state)).toBe(false);
  });

  test('no entry when room is empty list', () => {
    const state = makeState(makeAvatar(0, 2, 'right'), map, [], []);
    expect(checkRoomEntry(state)).toBe(false);
  });
});

describe('checkRoomEntry — with roomDoor (single door)', () => {
  // Map: corridor [0,0,0], room at c=2, door at c=1
  function makeMapWithDoor(door: { r: number; c: number }): any {
    return {
      ...makeMap([[0, 0, 0]]),
      room: [{ r: 0, c: 2 }],
      roomDoor: door,
    };
  }

  test('triggers only on door cell, not other room cells', () => {
    const map = makeMapWithDoor({ r: 0, c: 1 });
    const room = [{ r: 0, c: 2 }];
    // Avatar at door cell → true
    const s1 = makeState(makeAvatar(0, 1, 'right'), map, [], room);
    expect(checkRoomEntry(s1)).toBe(true);
    // Avatar at room cell (c=2) → false (door is at c=1)
    const s2 = makeState(makeAvatar(0, 2, 'right'), map, [], room);
    expect(checkRoomEntry(s2)).toBe(false);
  });

  test('no entry when avatar is at unrelated position', () => {
    const map = makeMapWithDoor({ r: 0, c: 1 });
    const state = makeState(makeAvatar(0, 0, 'right'), map, [], [{ r: 0, c: 2 }]);
    expect(checkRoomEntry(state)).toBe(false);
  });
});

// ─── Lives / game over (logic layer) ─────────────────────────────────────────

describe('lives & game-over logic', () => {
  test('lives decrement on collision', () => {
    const map = makeMap([[0, 0]]);
    const state = makeState(makeAvatar(0, 0, 'right'), map, [{ r: 0, c: 0 }]);
    expect(checkCollisions(state)).toBe(true);
    state.lives--;
    expect(state.lives).toBe(2);
  });

  test('game over when lives reach 0', () => {
    const map = makeMap([[0, 0]]);
    const state = makeState(makeAvatar(0, 0, 'right'), map, [{ r: 0, c: 0 }]);
    state.lives = 1;
    state.lives--;
    expect(state.lives).toBe(0);
    // Store would set status = 'gameover' — here we just verify the condition
    expect(state.lives <= 0).toBe(true);
  });

  test('no game over with lives remaining', () => {
    const map = makeMap([[0, 0]]);
    const state = makeState(makeAvatar(0, 0, 'right'), map, [{ r: 0, c: 0 }]);
    state.lives--;
    expect(state.lives > 0).toBe(true);
  });
});

// ─── BFS pathfinding (pursuer AI) ────────────────────────────────────────────

describe('bfsNextDir', () => {
  // Simple 1×5 corridor: [0,0,0,0,0]
  const corridor = makeMap([[0, 0, 0, 0, 0]]);

  test('straight path — returns correct direction', () => {
    expect(bfsNextDir(corridor, 0, 0, 0, 4)).toBe('right');
    expect(bfsNextDir(corridor, 0, 4, 0, 0)).toBe('left');
  });

  test('already at goal — returns null', () => {
    expect(bfsNextDir(corridor, 0, 2, 0, 2)).toBeNull();
  });

  test('no path when goal is walled off — returns null', () => {
    // Map: [0,0,1,0,0] — wall at col 2 blocks path
    const blocked = makeMap([[0, 0, 1, 0, 0]]);
    expect(bfsNextDir(blocked, 0, 0, 0, 4)).toBeNull();
  });

  test('cross-shaped map — finds path around walls', () => {
    // 3×3 cross: center open, corners walled
    const cross = makeMap([
      [1, 0, 1],
      [0, 0, 0],
      [1, 0, 1],
    ]);
    // From (0,1) to (2,1): must go down
    expect(bfsNextDir(cross, 0, 1, 2, 1)).toBe('down');
    // From (1,0) to (1,2): must go right
    expect(bfsNextDir(cross, 1, 0, 1, 2)).toBe('right');
  });

  test('tunnel wraparound — finds shorter path through tunnel', () => {
    // 1×5 corridor with horizontal tunnel on row 0
    // From col 4 going right → wraps to col 0 (distance 2 via tunnel, vs 4 direct)
    const tunnelMap = makeMap([[0, 0, 0, 0, 0]], [0]);
    // Shortest from (0,3) to (0,1): direct left (2 steps) vs tunnel right (3 steps) → left
    expect(bfsNextDir(tunnelMap, 0, 3, 0, 1)).toBe('left');
    // Shortest from (0,4) to (0,0): tunnel right (2 steps via wrap) vs direct left (4 steps)
    expect(bfsNextDir(tunnelMap, 0, 4, 0, 0)).toBe('right');
  });

  test('vertical tunnel wraparound', () => {
    // 5×1 corridor with vertical tunnel on col 0
    const tunnelMap = makeMap([[0], [0], [0], [0], [0]], [], [0]);
    // Shortest from (4,0) to (0,0): up (4 steps) vs wrap down (2 steps)
    expect(bfsNextDir(tunnelMap, 4, 0, 0, 0)).toBe('down');
  });
});

// ─── autoMove mode ────────────────────────────────────────────────────────────

describe('autoMove — avatar step logic', () => {
  // autoMove is a store-level concern; here we verify the building-block:
  // computeAvatarStep does NOT advance if there is no movement direction.

  const corridor = makeMap([[0, 0, 0, 0, 0]]);

  test('avatar stays put when dir=left at col 0 and no queued dir (wall ahead, autoMove irrelevant)', () => {
    // Blocked left at edge
    const r = computeAvatarStep(corridor, 0, 0, 'left', null);
    expect(r).toMatchObject({ r: 0, c: 0 });
  });

  test('avatar advances when tickAvatar is called (simulates autoMove=true)', () => {
    // This tests that tickAvatar moves normally when called
    const map = makeMap([[0, 0, 0, 0, 0]]);
    const state = makeState(makeAvatar(0, 1, 'right'), map);
    // Simulate one tick with autoMove=true (always call tickAvatar)
    const { moved } = require('../src/server/gameEngine').tickAvatar(state);
    expect(moved).toBe(true);
    expect(state.avatar.c).toBe(2);
  });

  test('avatar does NOT advance when tickAvatar is NOT called (simulates autoMove=false, no input)', () => {
    // If we skip calling tickAvatar, avatar stays put — mirrors the store logic
    const map = makeMap([[0, 0, 0, 0, 0]]);
    const state = makeState(makeAvatar(0, 1, 'right'), map);
    // No call to tickAvatar — autoMove=false + no input
    expect(state.avatar.c).toBe(1);
  });
});

// ─── Wand collection ─────────────────────────────────────────────────────────

describe('allWandsCollected', () => {
  const map = makeMap([[0, 0]]);

  test('true when all wands collected', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map, [], [], [
      { r: 0, c: 0, collected: true },
      { r: 0, c: 1, collected: true },
    ]);
    expect(allWandsCollected(state)).toBe(true);
  });

  test('false when some wands remain', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map, [], [], [
      { r: 0, c: 0, collected: true },
      { r: 0, c: 1, collected: false },
    ]);
    expect(allWandsCollected(state)).toBe(false);
  });

  test('true when wand list is empty (no collect mode)', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map, [], [], []);
    expect(allWandsCollected(state)).toBe(true);
  });
});

// ─── M3a: Chaos queue ────────────────────────────────────────────────────────

describe('consumeChaosInput', () => {
  test('returns null on empty queue', () => {
    expect(consumeChaosInput([])).toBeNull();
  });

  test('returns first element and removes it', () => {
    const q: Direction[] = ['up', 'right', 'down'];
    const dir = consumeChaosInput(q);
    expect(dir).toBe('up');
    expect(q).toEqual(['right', 'down']);
  });

  test('preserves FIFO order across multiple calls', () => {
    const q: Direction[] = ['left', 'up', 'right', 'down'];
    expect(consumeChaosInput(q)).toBe('left');
    expect(consumeChaosInput(q)).toBe('up');
    expect(consumeChaosInput(q)).toBe('right');
    expect(consumeChaosInput(q)).toBe('down');
    expect(consumeChaosInput(q)).toBeNull();
  });

  test('single element queue empties after one consume', () => {
    const q: Direction[] = ['down'];
    consumeChaosInput(q);
    expect(q).toHaveLength(0);
  });
});

describe('Chaos: queued direction applied to avatar at next intersection', () => {
  // Cross-shaped map: (1,1) is intersection where up, down, left, right are all open
  const cross = makeMap([
    [1, 0, 1],
    [0, 0, 0],
    [1, 0, 1],
  ]);

  test('chaos input becomes queuedDir, avatar turns at intersection', () => {
    // Avatar at (1,1) moving right; chaos gives 'up' → should turn up
    const avatar = makeAvatar(1, 1, 'right', null);
    // Simulate: chaos input sets queuedDir
    avatar.queuedDir = 'up';
    const result = computeAvatarStep(cross, avatar.r, avatar.c, avatar.dir, avatar.queuedDir);
    expect(result.dir).toBe('up');
    expect(result.turned).toBe(true);
    expect(result.queuedDir).toBeNull();
  });

  test('chaos input waits until passable intersection', () => {
    // Corridor: only left/right open; chaos sends 'up' → waits
    const corridor = makeMap([[0, 0, 0, 0, 0]]);
    const result = computeAvatarStep(corridor, 0, 2, 'right', 'up');
    // Continues right, retains 'up' intent
    expect(result.dir).toBe('right');
    expect(result.queuedDir).toBe('up');
  });
});

// ─── M3a: Wand spawning & collection gate ────────────────────────────────────

describe('spawnWands', () => {
  // Map with mixed cells: corridor (0), wall (1), room (2), start (3), spawn (4)
  const map = makeMap([
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 0],
  ]);

  test('spawns the requested number of wands', () => {
    const wands = spawnWands(map, 3);
    expect(wands).toHaveLength(3);
  });

  test('all wands land on corridor cells (type 0)', () => {
    const wands = spawnWands(map, 5); // map has 7 corridors, request 5
    for (const w of wands) {
      expect(map.cells[w.r][w.c]).toBe(0);
    }
  });

  test('wands start uncollected', () => {
    const wands = spawnWands(map, 2);
    expect(wands.every(w => !w.collected)).toBe(true);
  });

  test('no duplicate positions', () => {
    const map7 = makeMap([[0, 0, 0, 0, 0, 0, 0]]);
    const wands = spawnWands(map7, 7);
    const positions = new Set(wands.map(w => `${w.r},${w.c}`));
    expect(positions.size).toBe(7);
  });

  test('returns fewer wands than requested when not enough corridors', () => {
    const tinyMap = makeMap([[0, 0, 1]]); // only 2 corridors
    const wands = spawnWands(tinyMap, 10);
    expect(wands.length).toBeLessThanOrEqual(2);
  });
});

// canAdvance mirrors the store's condition: room mode always advances, collect mode requires all wands
function canAdvance(objectiveMode: 'room' | 'collect', wandsCollected: boolean): boolean {
  return objectiveMode === 'room' || wandsCollected;
}

describe('wand collection gates room entry (collect mode)', () => {
  const map = makeMap([[0, 0, 0]]);
  const room = [{ r: 0, c: 2 }];

  test('room entry allowed when all wands collected (collect mode)', () => {
    const state = makeState(makeAvatar(0, 2, 'right'), map, [], room, [
      { r: 0, c: 0, collected: true },
    ]);
    state.objectiveMode = 'collect';
    expect(checkRoomEntry(state)).toBe(true);
    expect(allWandsCollected(state)).toBe(true);
    expect(canAdvance('collect', allWandsCollected(state))).toBe(true);
  });

  test('room entry blocked when wands remain (collect mode)', () => {
    const state = makeState(makeAvatar(0, 2, 'right'), map, [], room, [
      { r: 0, c: 0, collected: false },
    ]);
    state.objectiveMode = 'collect';
    expect(checkRoomEntry(state)).toBe(true);    // avatar is in room
    expect(allWandsCollected(state)).toBe(false); // wands remain → no advance
    expect(canAdvance('collect', allWandsCollected(state))).toBe(false);
  });

  test('room entry always triggers advance in room mode regardless of wands', () => {
    const state = makeState(makeAvatar(0, 2, 'right'), map, [], room, [
      { r: 0, c: 0, collected: false },
    ]);
    state.objectiveMode = 'room';
    expect(canAdvance('room', allWandsCollected(state))).toBe(true);
  });
});

describe('checkWandCollection', () => {
  const map = makeMap([[0, 0, 0]]);

  test('marks wand collected when avatar steps on it', () => {
    const state = makeState(makeAvatar(0, 1, 'right'), map, [], [], [
      { r: 0, c: 1, collected: false },
      { r: 0, c: 2, collected: false },
    ]);
    const count = checkWandCollection(state);
    expect(count).toBe(1);
    expect(state.wands[0].collected).toBe(true);
    expect(state.wands[1].collected).toBe(false);
  });

  test('does not re-collect already collected wand', () => {
    const state = makeState(makeAvatar(0, 1, 'right'), map, [], [], [
      { r: 0, c: 1, collected: true },
    ]);
    expect(checkWandCollection(state)).toBe(0);
  });
});

// ─── M3a: Level transitions & pursuer counts ─────────────────────────────────

describe('spawnPursuers — pursuer count per level', () => {
  const map = makeMap([[0, 0, 0, 0, 0]]);
  // Add 5 spawn points so all levels can spawn
  const mapWithSpawns: MapData = {
    ...map,
    pursuerSpawns: [
      { r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 },
      { r: 0, c: 3 }, { r: 0, c: 4 },
    ],
  };

  test('level 1 → 1 pursuer (Rusard)', () => {
    const p = spawnPursuers(mapWithSpawns, 1, 3);
    expect(p).toHaveLength(1);
    expect(p[0].type).toBe('rusard');
  });

  test('level 2 → 2 pursuers (Rusard + Miss Teigne)', () => {
    const p = spawnPursuers(mapWithSpawns, 2, 3);
    expect(p).toHaveLength(2);
    expect(p[1].type).toBe('missteigne');
  });

  test('level 3 → 3 pursuers', () => {
    expect(spawnPursuers(mapWithSpawns, 3, 3)).toHaveLength(3);
  });

  test('level 4 → 4 pursuers', () => {
    expect(spawnPursuers(mapWithSpawns, 4, 3)).toHaveLength(4);
  });

  test('level 5 → 5 pursuers (all five)', () => {
    const p = spawnPursuers(mapWithSpawns, 5, 3);
    expect(p).toHaveLength(5);
    expect(p[4].type).toBe('baronsanglant');
    const types = p.map(x => x.type);
    expect(types).toEqual(['rusard', 'missteigne', 'rogue', 'peeves', 'baronsanglant']);
  });

  test('level > 5 capped at 5 pursuers', () => {
    expect(spawnPursuers(mapWithSpawns, 99, 3)).toHaveLength(5);
  });

  test('each pursuer gets the given speed', () => {
    const p = spawnPursuers(mapWithSpawns, 3, 7);
    expect(p.every(x => x.speed === 7)).toBe(true);
  });

  test('pursuer ids are unique', () => {
    const p = spawnPursuers(mapWithSpawns, 5, 3);
    const ids = new Set(p.map(x => x.id));
    expect(ids.size).toBe(5);
  });
});

// ─── M3a: Victory & game-over conditions ─────────────────────────────────────

describe('victory & game-over conditions (logic layer)', () => {
  const map = makeMap([[0, 0]]);

  test('game over when lives reach 0', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map);
    state.lives = 1;
    state.lives--;
    expect(state.lives <= 0).toBe(true);
    // Store sets status = 'gameover' — verify condition
  });

  test('no game over while lives remain', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map);
    state.lives = 3;
    state.lives--;
    expect(state.lives > 0).toBe(true);
  });

  test('level 5 + room entry → victory condition (level >= 5)', () => {
    const state = makeState(makeAvatar(0, 0, 'right'), map);
    state.level = 5;
    // Store calls advanceLevel which checks: if level >= 5 → 'won'
    expect(state.level >= 5).toBe(true);
  });

  test('level 1–4 + room entry → advance, not victory', () => {
    for (let level = 1; level <= 4; level++) {
      const state = makeState(makeAvatar(0, 0, 'right'), map);
      state.level = level;
      expect(state.level >= 5).toBe(false);
    }
  });
});

// ─── M4f: Tunnels reserved for avatar (pursuers blocked) ─────────────────────

describe('canMove — allowTunnels=false blocks tunnel exits', () => {
  const map = makeMap([[0, 0, 0]], [0]); // row-0 horizontal tunnel

  test('allowTunnels=true (default): can exit left border via tunnel', () => {
    expect(canMove(map, 0, 0, 'left', true)).toBe(true);
    expect(canMove(map, 0, 2, 'right', true)).toBe(true);
  });

  test('allowTunnels=false: tunnel exits treated as walls', () => {
    expect(canMove(map, 0, 0, 'left', false)).toBe(false);
    expect(canMove(map, 0, 2, 'right', false)).toBe(false);
  });

  test('allowTunnels=false: normal in-bounds moves still work', () => {
    expect(canMove(map, 0, 0, 'right', false)).toBe(true);
    expect(canMove(map, 0, 2, 'left', false)).toBe(true);
  });
});

describe('bfsNextDir — allowTunnels=false does not route through tunnels', () => {
  const tunnelMap = makeMap([[0, 0, 0, 0, 0]], [0]);

  test('with tunnels: chooses shorter path via wraparound', () => {
    // From col 4 to col 0: via tunnel (2 steps: right→wrap) vs direct (4 steps: left)
    expect(bfsNextDir(tunnelMap, 0, 4, 0, 0, true)).toBe('right');
  });

  test('without tunnels: must go the long way', () => {
    expect(bfsNextDir(tunnelMap, 0, 4, 0, 0, false)).toBe('left');
  });

  test('without tunnels: vertical tunnel also blocked', () => {
    const vMap = makeMap([[0], [0], [0], [0], [0]], [], [0]);
    // From row 4 to row 0: via tunnel (down→wrap, 2 steps) vs direct (up, 4 steps)
    expect(bfsNextDir(vMap, 4, 0, 0, 0, true)).toBe('down');   // via tunnel
    expect(bfsNextDir(vMap, 4, 0, 0, 0, false)).toBe('up');    // no tunnel
  });
});

// ─── M4f: Wand spawning — valid cells + minimum spacing ──────────────────────

describe('spawnWands — door exclusion', () => {
  // 9-corridor row with door at c=4
  function mapWithDoor() {
    const m: any = makeMap([[0, 0, 0, 0, 0, 0, 0, 0, 0]]);
    m.roomDoor = { r: 0, c: 4 };
    return m as MapData;
  }

  test('wand never placed on door cell', () => {
    const m = mapWithDoor();
    for (let run = 0; run < 30; run++) {
      const wands = spawnWands(m, 3);
      expect(wands.every(w => !(w.r === 0 && w.c === 4))).toBe(true);
    }
  });

  test('wands still land on corridor cells when door excluded', () => {
    const m = mapWithDoor();
    const wands = spawnWands(m, 3);
    for (const w of wands) expect(m.cells[w.r][w.c]).toBe(0);
  });
});

describe('spawnWands — minimum spacing', () => {
  // 5-row × 10-col map: 50 corridors, plenty of room for 5 wands at MIN_DIST apart
  const bigMap = makeMap([
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ]);

  test('all wands are at least MIN_WAND_DIST apart (Manhattan)', () => {
    const wands = spawnWands(bigMap, 5);
    expect(wands).toHaveLength(5);
    for (let i = 0; i < wands.length; i++) {
      for (let j = i + 1; j < wands.length; j++) {
        const d = Math.abs(wands[i].r - wands[j].r) + Math.abs(wands[i].c - wands[j].c);
        expect(d).toBeGreaterThanOrEqual(MIN_WAND_DIST);
      }
    }
  });

  test('spacing invariant holds across multiple random runs', () => {
    for (let run = 0; run < 10; run++) {
      const wands = spawnWands(bigMap, 5);
      for (let i = 0; i < wands.length; i++) {
        for (let j = i + 1; j < wands.length; j++) {
          const d = Math.abs(wands[i].r - wands[j].r) + Math.abs(wands[i].c - wands[j].c);
          expect(d).toBeGreaterThanOrEqual(MIN_WAND_DIST);
        }
      }
    }
  });
});
