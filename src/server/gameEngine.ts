import {
  GameState,
  Direction,
  MapData,
  Avatar,
  Pursuer,
  CellType,
  VoteTally,
  TimedInput,
  PursuerType,
} from '../shared/types';

const PURSUER_NAMES: PursuerType[] = ['rusard', 'missteigne', 'rogue', 'peeves', 'baronsanglant'];

export function isWalkable(map: MapData, r: number, c: number): boolean {
  if (r < 0 || r >= map.height || c < 0 || c >= map.width) return false;
  const cell = map.cells[r][c];
  return cell === 0 || cell === 2 || cell === 3 || cell === 4;
}

export function applyTunnel(
  map: MapData,
  r: number,
  c: number,
): { r: number; c: number } {
  let nr = r;
  let nc = c;
  if (c < 0 && map.tunnels.horizontal.includes(r)) nc = map.width - 1;
  else if (c >= map.width && map.tunnels.horizontal.includes(r)) nc = 0;
  if (r < 0 && map.tunnels.vertical.includes(c)) nr = map.height - 1;
  else if (r >= map.height && map.tunnels.vertical.includes(c)) nr = 0;
  return { r: nr, c: nc };
}

export function dirDelta(dir: Direction): { dr: number; dc: number } {
  switch (dir) {
    case 'up': return { dr: -1, dc: 0 };
    case 'down': return { dr: 1, dc: 0 };
    case 'left': return { dr: 0, dc: -1 };
    case 'right': return { dr: 0, dc: 1 };
  }
}

export function canMove(map: MapData, r: number, c: number, dir: Direction, allowTunnels = true): boolean {
  const { dr, dc } = dirDelta(dir);
  const nr = r + dr;
  const nc = c + dc;
  if (!allowTunnels) return isWalkable(map, nr, nc);
  const tunneled = applyTunnel(map, nr, nc);
  return isWalkable(map, tunneled.r, tunneled.c);
}

export function moveEntity(
  map: MapData,
  r: number,
  c: number,
  dir: Direction,
): { r: number; c: number } {
  const { dr, dc } = dirDelta(dir);
  return applyTunnel(map, r + dr, c + dc);
}

// Democracy: pick the most voted direction, random on tie
export function aggregateDemocracy(inputs: TimedInput[], windowMs: number, now: number): Direction | null {
  const cutoff = now - windowMs;
  const recent = inputs.filter(i => i.ts >= cutoff);
  if (recent.length === 0) return null;

  const tally: VoteTally = { up: 0, down: 0, left: 0, right: 0 };
  for (const i of recent) tally[i.dir]++;

  const max = Math.max(tally.up, tally.down, tally.left, tally.right);
  const winners = (Object.keys(tally) as Direction[]).filter(d => tally[d] === max);
  return winners[Math.floor(Math.random() * winners.length)];
}

export function buildVoteTally(inputs: TimedInput[], windowMs: number, now: number): VoteTally {
  const cutoff = now - windowMs;
  const recent = inputs.filter(i => i.ts >= cutoff);
  const tally: VoteTally = { up: 0, down: 0, left: 0, right: 0 };
  for (const i of recent) tally[i.dir]++;
  return tally;
}

// Pure step computation — no side effects, fully testable
export function computeAvatarStep(
  map: MapData,
  r: number,
  c: number,
  dir: Direction,
  queuedDir: Direction | null,
): { r: number; c: number; dir: Direction; queuedDir: Direction | null; turned: boolean } {
  // Try queued direction first (Pac-Man: turn whenever intersection allows)
  if (queuedDir && canMove(map, r, c, queuedDir)) {
    const pos = moveEntity(map, r, c, queuedDir);
    return { r: pos.r, c: pos.c, dir: queuedDir, queuedDir: null, turned: true };
  }
  // Continue in current direction
  if (canMove(map, r, c, dir)) {
    const pos = moveEntity(map, r, c, dir);
    return { r: pos.r, c: pos.c, dir, queuedDir, turned: false };
  }
  // Blocked — keep queued intent for later
  return { r, c, dir, queuedDir, turned: false };
}

// Move avatar one step in the game state (mutates avatar in place)
export function tickAvatar(state: GameState): { moved: boolean } {
  const { avatar, activeMap } = state;
  const result = computeAvatarStep(activeMap, avatar.r, avatar.c, avatar.dir, avatar.queuedDir);
  const moved = result.r !== avatar.r || result.c !== avatar.c;
  avatar.r = result.r;
  avatar.c = result.c;
  avatar.dir = result.dir;
  avatar.queuedDir = result.queuedDir;
  return { moved };
}

// Apply a direction input to avatar (queue it)
export function applyDirectionToAvatar(state: GameState, dir: Direction): void {
  state.avatar.queuedDir = dir;
}

/**
 * BFS on the walkable grid (respecting tunnels) from (startR,startC) toward (goalR,goalC).
 * Returns the first Direction to take, or null if no path exists.
 */
export function bfsNextDir(
  map: MapData,
  startR: number,
  startC: number,
  goalR: number,
  goalC: number,
  allowTunnels = true,
): Direction | null {
  if (startR === goalR && startC === goalC) return null;
  const DIRS: Direction[] = ['up', 'down', 'left', 'right'];
  const visited = new Set<string>();
  visited.add(`${startR},${startC}`);
  const queue: Array<{ r: number; c: number; firstDir: Direction }> = [];
  for (const dir of DIRS) {
    if (canMove(map, startR, startC, dir, allowTunnels)) {
      const { r, c } = moveEntity(map, startR, startC, dir);
      const key = `${r},${c}`;
      if (!visited.has(key)) {
        visited.add(key);
        if (r === goalR && c === goalC) return dir;
        queue.push({ r, c, firstDir: dir });
      }
    }
  }
  while (queue.length > 0) {
    const { r, c, firstDir } = queue.shift()!;
    for (const dir of DIRS) {
      if (canMove(map, r, c, dir, allowTunnels)) {
        const next = moveEntity(map, r, c, dir);
        const key = `${next.r},${next.c}`;
        if (!visited.has(key)) {
          visited.add(key);
          if (next.r === goalR && next.c === goalC) return firstDir;
          queue.push({ r: next.r, c: next.c, firstDir });
        }
      }
    }
  }
  return null;
}

// Pursuer AI: BFS pathfinding toward avatar with 30% random deviation.
// Tunnels are reserved for the avatar — pursuers treat tunnel exits as walls.
export function tickPursuer(map: MapData, pursuer: Pursuer, avatar: Avatar): void {
  const DIRS: Direction[] = ['up', 'down', 'left', 'right'];
  const walkable = DIRS.filter(d => canMove(map, pursuer.r, pursuer.c, d, false));
  if (walkable.length === 0) return;

  let chosenDir: Direction;
  if (Math.random() < 0.3) {
    chosenDir = walkable[Math.floor(Math.random() * walkable.length)];
  } else {
    const bfsDir = bfsNextDir(map, pursuer.r, pursuer.c, avatar.r, avatar.c, false);
    chosenDir = (bfsDir && walkable.includes(bfsDir))
      ? bfsDir
      : walkable[Math.floor(Math.random() * walkable.length)];
  }

  const pos = moveEntity(map, pursuer.r, pursuer.c, chosenDir);
  pursuer.r = pos.r;
  pursuer.c = pos.c;
  pursuer.dir = chosenDir;
}

export function checkCollisions(state: GameState): boolean {
  for (const pursuer of state.pursuers) {
    if (pursuer.r === state.avatar.r && pursuer.c === state.avatar.c) {
      return true;
    }
  }
  return false;
}

export function checkWandCollection(state: GameState): number {
  let count = 0;
  for (const wand of state.wands) {
    if (!wand.collected && wand.r === state.avatar.r && wand.c === state.avatar.c) {
      wand.collected = true;
      count++;
    }
  }
  return count;
}

export function checkRoomEntry(state: GameState): boolean {
  const { avatar, activeMap } = state;
  if (activeMap.roomDoor) {
    return avatar.r === activeMap.roomDoor.r && avatar.c === activeMap.roomDoor.c;
  }
  // Fallback for maps without explicit roomDoor
  return activeMap.room.some(cell => cell.r === avatar.r && cell.c === avatar.c);
}

export function allWandsCollected(state: GameState): boolean {
  return state.wands.every(w => w.collected);
}

export function spawnPursuers(map: MapData, level: number, speed: number): Pursuer[] {
  const count = Math.min(level, 5);
  return PURSUER_NAMES.slice(0, count).map((type, i) => {
    const spawn = map.pursuerSpawns[i] ?? map.pursuerSpawns[0];
    return { id: `pursuer-${i}`, type, r: spawn.r, c: spawn.c, dir: 'left' as Direction, speed };
  });
}

// Chaos mode: consume one direction from the queue; returns null when empty.
export function consumeChaosInput(chaosQueue: Direction[]): Direction | null {
  if (chaosQueue.length === 0) return null;
  return chaosQueue.shift()!;
}

/** Minimum Manhattan distance enforced between any two spawned wands. */
export const MIN_WAND_DIST = 4;

export function spawnWands(map: MapData, count: number): { r: number; c: number; collected: boolean }[] {
  const corridors: { r: number; c: number }[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      if (map.cells[r][c] !== 0) continue;
      // Exclude the door cell (corridor overlay — would be inaccessible if door is closed)
      if (map.roomDoor && map.roomDoor.r === r && map.roomDoor.c === c) continue;
      corridors.push({ r, c });
    }
  }

  // Try up to 20 shuffles to find a valid spacing arrangement
  let placed: { r: number; c: number }[] = [];
  const shuffled = [...corridors];
  for (let attempt = 0; attempt < 20 && placed.length < count; attempt++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    placed = [];
    for (const cand of shuffled) {
      if (placed.length >= count) break;
      if (placed.every(p => Math.abs(p.r - cand.r) + Math.abs(p.c - cand.c) >= MIN_WAND_DIST)) {
        placed.push(cand);
      }
    }
  }

  // Fallback: fill remaining slots without spacing constraint (map too small)
  if (placed.length < count) {
    for (const cand of shuffled) {
      if (placed.length >= count) break;
      if (!placed.some(p => p.r === cand.r && p.c === cand.c)) placed.push(cand);
    }
  }

  return placed.map(pos => ({ ...pos, collected: false }));
}
