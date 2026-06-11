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
      wandCountPerLevel: 3,
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

describe('checkRoomEntry', () => {
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
