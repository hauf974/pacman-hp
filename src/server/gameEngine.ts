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

export function canMove(map: MapData, r: number, c: number, dir: Direction): boolean {
  const { dr, dc } = dirDelta(dir);
  const nr = r + dr;
  const nc = c + dc;
  // Check tunnel first
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

// Move avatar one step if possible; try queued direction first
export function tickAvatar(state: GameState): { moved: boolean; newDir: Direction } {
  const { avatar, activeMap } = state;

  // Try queued direction first
  if (avatar.queuedDir && canMove(activeMap, avatar.r, avatar.c, avatar.queuedDir)) {
    const pos = moveEntity(activeMap, avatar.r, avatar.c, avatar.queuedDir);
    avatar.r = pos.r;
    avatar.c = pos.c;
    avatar.dir = avatar.queuedDir;
    avatar.queuedDir = null;
    return { moved: true, newDir: avatar.dir };
  }

  // Continue in current direction
  if (canMove(activeMap, avatar.r, avatar.c, avatar.dir)) {
    const pos = moveEntity(activeMap, avatar.r, avatar.c, avatar.dir);
    avatar.r = pos.r;
    avatar.c = pos.c;
    return { moved: true, newDir: avatar.dir };
  }

  return { moved: false, newDir: avatar.dir };
}

// Apply a direction input to avatar (queue it)
export function applyDirectionToAvatar(state: GameState, dir: Direction): void {
  state.avatar.queuedDir = dir;
}

// Simple pursuer AI: try to move toward avatar, with some randomness
export function tickPursuer(map: MapData, pursuer: Pursuer, avatar: Avatar): void {
  const dirs: Direction[] = ['up', 'down', 'left', 'right'];

  // 70% chance to move toward avatar, 30% random
  const dr = avatar.r - pursuer.r;
  const dc = avatar.c - pursuer.c;

  let preferred: Direction[] = [];
  if (Math.abs(dr) > Math.abs(dc)) {
    preferred = dr > 0 ? ['down', 'up', 'left', 'right'] : ['up', 'down', 'left', 'right'];
  } else {
    preferred = dc > 0 ? ['right', 'left', 'up', 'down'] : ['left', 'right', 'up', 'down'];
  }

  const useRandom = Math.random() < 0.3;
  const order = useRandom
    ? [...dirs].sort(() => Math.random() - 0.5)
    : preferred;

  for (const dir of order) {
    if (canMove(map, pursuer.r, pursuer.c, dir)) {
      const pos = moveEntity(map, pursuer.r, pursuer.c, dir);
      pursuer.r = pos.r;
      pursuer.c = pos.c;
      pursuer.dir = dir;
      break;
    }
  }
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

export function spawnWands(map: MapData, count: number): { r: number; c: number; collected: boolean }[] {
  const corridors: { r: number; c: number }[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const cell = map.cells[r][c] as CellType;
      if (cell === 0) corridors.push({ r, c });
    }
  }
  // Shuffle and pick
  for (let i = corridors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [corridors[i], corridors[j]] = [corridors[j], corridors[i]];
  }
  return corridors.slice(0, count).map(pos => ({ ...pos, collected: false }));
}
