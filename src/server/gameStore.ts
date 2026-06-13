import * as fs from 'fs';
import * as path from 'path';
import {
  GameState,
  GameStatus,
  MapData,
  GameSettings,
  PublicGameState,
  Player,
  Direction,
  TimedInput,
} from '../shared/types';
import {
  tickAvatar,
  tickPursuer,
  checkCollisions,
  checkWandCollection,
  checkRoomEntry,
  allWandsCollected,
  spawnPursuers,
  spawnWands,
  aggregateDemocracy,
  buildVoteTally,
  applyDirectionToAvatar,
  consumeChaosInput,
} from './gameEngine';

const MAPS_DIR = path.join(process.cwd(), 'data', 'maps');

const DEFAULT_SETTINGS: GameSettings = {
  tempo: 'anime',
  atmosphere: 'parchemin',
  titleFont: 'UnifrakturCook',
  footprints: true,
  pursuerSpeed: 2,
  avatarSpeed: 4,
  voteWindowSec: 0.5,
  wandCountPerLevel: 5,
  autoMove: false,
  startingLevel: 1,
  avatarIcon: 'hat',
  levelMaps: ['', '', '', '', ''],
};

// Rate limiter constants
const INPUT_RATE_WINDOW_MS = 1000;
const INPUT_RATE_MAX = 20;      // max inputs per player per second
const CHAOS_QUEUE_MAX = 200;    // ~30 s at 6 inputs/s — prevents unbounded growth

function loadMap(name: string): MapData {
  const file = path.join(MAPS_DIR, `${name}.json`);
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as MapData;
}

function loadMapSafe(name: string): MapData {
  try {
    return loadMap(name);
  } catch {
    return loadMap('pacman');
  }
}

function createInitialState(mapName = 'pacman'): GameState {
  const map = loadMapSafe(mapName);
  return {
    status: 'lobby',
    mode: 'democracy',
    objectiveMode: 'collect',
    level: 1,
    lives: 3,
    activeMap: map,
    avatar: {
      r: map.avatarStart.r,
      c: map.avatarStart.c,
      dir: 'left',
      queuedDir: null,
      speed: DEFAULT_SETTINGS.avatarSpeed,
    },
    pursuers: [],
    wands: [],
    players: {},
    inputBuffer: [],
    chaosQueue: [],
    voteTally: { up: 0, down: 0, left: 0, right: 0 },
    settings: { ...DEFAULT_SETTINGS },
    toursJoues: 0,
  };
}

export class GameStore {
  private state: GameState;
  private activeMapName = 'pacman';
  private avatarTickAccum = 0;
  private pursuerTickAccum = 0;

  // Cleanup timers keyed by player token (token is stable across socket rebinds)
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Rate limiter: socket id → sorted timestamp array within current window
  private inputRateLimiter = new Map<string, number[]>();

  private onBroadcast?: (state: PublicGameState) => void;
  private onChatEvent?: (event: {
    type: 'input' | 'join' | 'leave' | 'kick';
    pseudo: string;
    dir?: Direction;
    ts: number;
  }) => void;
  private onGameOver?: () => void;
  private onGameWon?: () => void;
  private onLevelTransition?: (level: number) => void;

  constructor(private readonly cleanupDelayMs = 5 * 60 * 1000) {
    this.state = createInitialState();
  }

  setCallbacks(cbs: {
    onBroadcast: (state: PublicGameState) => void;
    onChatEvent: (event: { type: 'input' | 'join' | 'leave' | 'kick'; pseudo: string; dir?: Direction; ts: number }) => void;
    onGameOver: () => void;
    onGameWon: () => void;
    onLevelTransition: (level: number) => void;
  }) {
    this.onBroadcast = cbs.onBroadcast;
    this.onChatEvent = cbs.onChatEvent;
    this.onGameOver = cbs.onGameOver;
    this.onGameWon = cbs.onGameWon;
    this.onLevelTransition = cbs.onLevelTransition;
  }

  getPublicState(): PublicGameState {
    const s = this.state;
    const players = Object.values(s.players);
    const wandCollected = s.wands.filter(w => w.collected).length;
    return {
      status: s.status,
      mode: s.mode,
      objectiveMode: s.objectiveMode,
      level: s.level,
      lives: s.lives,
      mapName: s.activeMap.name,
      mapWidth: s.activeMap.width,
      mapHeight: s.activeMap.height,
      mapCells: s.activeMap.cells,
      mapTunnels: s.activeMap.tunnels,
      mapRoomDoor: s.activeMap.roomDoor ?? null,
      avatar: { ...s.avatar },
      pursuers: s.pursuers.map(p => ({ ...p })),
      wands: s.wands.map(w => ({ ...w })),
      players: players.map(p => ({
        id: p.id,
        pseudo: p.pseudo,
        connected: p.connected,
        lastInput: p.lastInput,
      })),
      voteTally: { ...s.voteTally },
      settings: { ...s.settings },
      toursJoues: s.toursJoues,
      wandTotal: s.wands.length,
      wandCollected,
    };
  }

  // Exposed for tests only — returns a shallow copy of players record
  getPlayersSnapshot(): Record<string, Player> {
    const out: Record<string, Player> = {};
    for (const [k, v] of Object.entries(this.state.players)) out[k] = { ...v };
    return out;
  }

  getStatus(): GameStatus {
    return this.state.status;
  }

  tick(dtMs: number) {
    const s = this.state;
    if (s.status !== 'playing') return;

    const connectedCount = Object.values(s.players).filter(p => p.connected).length;
    if (connectedCount === 0) {
      s.status = 'paused';
      this.broadcast();
      return;
    }

    const now = Date.now();
    const avatarPeriodMs = 1000 / s.avatar.speed;
    const pursuerPeriodMs = 1000 / s.settings.pursuerSpeed;

    // Process input for avatar movement direction
    this.avatarTickAccum += dtMs;
    if (this.avatarTickAccum >= avatarPeriodMs) {
      this.avatarTickAccum -= avatarPeriodMs;

      let hasInput = false;
      if (s.mode === 'democracy') {
        const dir = aggregateDemocracy(s.inputBuffer, s.settings.voteWindowSec * 1000, now);
        // Capture tally before clearing so the UI shows what was just voted
        s.voteTally = buildVoteTally(s.inputBuffer, s.settings.voteWindowSec * 1000, now);
        if (dir) {
          applyDirectionToAvatar(s, dir);
          s.toursJoues++;
          hasInput = true;
          // Manual mode: clear the buffer so the same vote cannot re-fire on the next tick
          if (!s.settings.autoMove) s.inputBuffer = [];
        }
      } else {
        // Chaos: apply next queued direction
        const dir = consumeChaosInput(s.chaosQueue);
        if (dir !== null) {
          applyDirectionToAvatar(s, dir);
          s.toursJoues++;
          hasInput = true;
        }
        s.voteTally = buildVoteTally(s.inputBuffer, s.settings.voteWindowSec * 1000, now);
      }

      // autoMove=false: only step when an input was actually played
      if (s.settings.autoMove || hasInput) {
        tickAvatar(s);
      }

      // Check wand collection
      if (s.objectiveMode === 'collect') {
        checkWandCollection(s);
      }

      // Check room entry
      if (checkRoomEntry(s)) {
        const canAdvance = s.objectiveMode === 'room' || allWandsCollected(s);
        if (canAdvance) {
          this.advanceLevel();
          return;
        }
      }

      // Check collisions after avatar move
      if (checkCollisions(s) && this.handleCollision()) return;
    }

    // Tick pursuers
    this.pursuerTickAccum += dtMs;
    if (this.pursuerTickAccum >= pursuerPeriodMs) {
      this.pursuerTickAccum -= pursuerPeriodMs;
      for (const pursuer of s.pursuers) {
        tickPursuer(s.activeMap, pursuer, s.avatar);
      }
      // Check collisions after pursuer move
      if (checkCollisions(s) && this.handleCollision()) return;
    }

    this.broadcast();
  }

  /** Returns true if the game ended (game over). */
  private handleCollision(): boolean {
    const s = this.state;
    s.lives--;
    if (s.lives <= 0) {
      s.status = 'gameover';
      this.broadcast();
      this.onGameOver?.();
      return true;
    }
    // Reset avatar and pursuer positions
    s.avatar.r = s.activeMap.avatarStart.r;
    s.avatar.c = s.activeMap.avatarStart.c;
    s.avatar.queuedDir = null;
    s.pursuers = spawnPursuers(s.activeMap, s.level, s.settings.pursuerSpeed);
    return false;
  }

  private advanceLevel() {
    const s = this.state;
    if (s.level >= 5) {
      s.status = 'won';
      this.broadcast();
      this.onGameWon?.();
      return;
    }
    s.level++;
    s.status = 'levelTransition';
    this.broadcast();
    this.onLevelTransition?.(s.level);

    setTimeout(() => {
      if (s.status === 'levelTransition') {
        this.startLevel();
      }
    }, 3000);
  }

  private startLevel() {
    const s = this.state;
    // Load level-specific map if one is configured for this level.
    const levelMapName = s.settings.levelMaps?.[s.level - 1] ?? '';
    if (levelMapName) {
      s.activeMap = loadMapSafe(levelMapName);
    }
    s.avatar.r = s.activeMap.avatarStart.r;
    s.avatar.c = s.activeMap.avatarStart.c;
    s.avatar.dir = 'left';
    s.avatar.queuedDir = null;
    s.avatar.speed = s.settings.avatarSpeed;
    s.pursuers = spawnPursuers(s.activeMap, s.level, s.settings.pursuerSpeed);
    s.wands = s.objectiveMode === 'collect'
      ? spawnWands(s.activeMap, s.settings.wandCountPerLevel)
      : [];
    s.inputBuffer = [];
    s.chaosQueue = [];
    s.voteTally = { up: 0, down: 0, left: 0, right: 0 };
    s.status = 'playing';
    this.avatarTickAccum = 0;
    this.pursuerTickAccum = 0;
    this.broadcast();
  }

  // ---- Admin actions ----

  start() {
    const s = this.state;
    if (s.status === 'lobby' || s.status === 'gameover' || s.status === 'won') {
      s.level = Math.max(1, Math.min(5, s.settings.startingLevel));
      s.lives = 3;
      this.startLevel();
    } else if (s.status === 'paused') {
      s.status = 'playing';
      this.broadcast();
    }
  }

  pause() {
    if (this.state.status === 'playing') {
      this.state.status = 'paused';
      this.broadcast();
    }
  }

  reset() {
    // Cancel all pending cleanup timers
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
    this.inputRateLimiter.clear();
    this.state = createInitialState(this.activeMapName);
    this.avatarTickAccum = 0;
    this.pursuerTickAccum = 0;
    this.broadcast();
  }

  getActiveMapName(): string {
    return this.activeMapName;
  }

  setActiveMap(map: MapData): { ok: boolean; reason?: string } {
    const s = this.state;
    if (!(s.status === 'lobby' || s.status === 'gameover' || s.status === 'won')) {
      return { ok: false, reason: 'Changement de carte impossible en pleine partie (lobby ou reset uniquement).' };
    }
    this.activeMapName = map.name;
    s.activeMap = map;
    s.avatar.r = map.avatarStart.r;
    s.avatar.c = map.avatarStart.c;
    s.avatar.dir = 'left';
    s.avatar.queuedDir = null;
    s.pursuers = [];
    s.wands = [];
    this.broadcast();
    return { ok: true };
  }

  setMode(mode: 'democracy' | 'chaos') {
    this.state.mode = mode;
  }

  setSettings(partial: Partial<GameSettings> & { objectiveMode?: 'room' | 'collect' }) {
    const { objectiveMode, ...rest } = partial as Record<string, unknown>;
    Object.assign(this.state.settings, rest);
    if (objectiveMode !== undefined) {
      this.state.objectiveMode = objectiveMode as 'room' | 'collect';
    }
    // Sync live entity speeds immediately
    if (rest.avatarSpeed !== undefined) {
      this.state.avatar.speed = rest.avatarSpeed as number;
    }
    if (rest.pursuerSpeed !== undefined) {
      for (const p of this.state.pursuers) p.speed = rest.pursuerSpeed as number;
    }
  }

  forceLevel(level: number) {
    this.state.level = Math.max(1, Math.min(5, level));
    this.startLevel();
  }

  forceNextLevel() {
    this.advanceLevel();
  }

  forceGameOver() {
    const s = this.state;
    s.lives = 0;
    s.status = 'gameover';
    this.broadcast();
    this.onGameOver?.();
  }

  forceWin() {
    const s = this.state;
    s.status = 'won';
    this.broadcast();
    this.onGameWon?.();
  }

  // ---- Player actions ----

  playerJoin(id: string, pseudo: string, token: string) {
    const s = this.state;
    s.players[id] = {
      id,
      pseudo,
      connected: true,
      lastInput: null,
      lastSeen: Date.now(),
      token,
    };
    this.onChatEvent?.({ type: 'join', pseudo, ts: Date.now() });
    if (s.status === 'paused') {
      s.status = 'playing';
    }
    this.broadcast();
  }

  playerInput(id: string, dir: Direction) {
    const s = this.state;
    const player = s.players[id];
    if (!player || s.status !== 'playing') return;

    // Rate limit: silently drop excess inputs (prevents spam / bots)
    if (this.isRateLimited(id)) return;

    player.lastInput = dir;
    player.lastSeen = Date.now();

    const timedInput: TimedInput = { dir, ts: Date.now(), playerId: id };
    s.inputBuffer.push(timedInput);

    if (s.mode === 'chaos') {
      // Cap chaos queue to avoid unbounded memory growth
      if (s.chaosQueue.length < CHAOS_QUEUE_MAX) {
        s.chaosQueue.push(dir);
      }
    }

    // Keep democracy input buffer bounded
    if (s.inputBuffer.length > 500) {
      s.inputBuffer = s.inputBuffer.slice(-200);
    }

    this.onChatEvent?.({ type: 'input', pseudo: player.pseudo, dir, ts: Date.now() });
  }

  playerDisconnect(id: string) {
    const s = this.state;
    const player = s.players[id];
    if (!player) return;
    player.connected = false;
    this.onChatEvent?.({ type: 'leave', pseudo: player.pseudo, ts: Date.now() });

    // Clear rate limiter for this socket
    this.inputRateLimiter.delete(id);

    // Schedule cleanup: remove the player after `cleanupDelayMs` if not reconnected
    const existingTimer = this.cleanupTimers.get(player.token);
    if (existingTimer) clearTimeout(existingTimer);

    const token = player.token;
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(token);
      // Find player by token (socket ID may have changed)
      const current = Object.values(s.players).find(p => p.token === token);
      if (current && !current.connected) {
        delete s.players[current.id];
        this.broadcast();
      }
    }, this.cleanupDelayMs);
    this.cleanupTimers.set(token, timer);

    const connectedCount = Object.values(s.players).filter(p => p.connected).length;
    if (connectedCount === 0 && s.status === 'playing') {
      s.status = 'paused';
    }
    this.broadcast();
  }

  playerReconnect(socketId: string, token: string): boolean {
    const s = this.state;
    const player = Object.values(s.players).find(p => p.token === token);
    if (!player) return false;

    // Cancel the pending cleanup timer for this token
    const timer = this.cleanupTimers.get(token);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(token);
    }

    // Clear rate limiter for old socket ID
    this.inputRateLimiter.delete(player.id);

    // Rebind socket id
    delete s.players[player.id];
    player.id = socketId;
    player.connected = true;
    player.lastSeen = Date.now();
    s.players[socketId] = player;

    // Announce return
    this.onChatEvent?.({ type: 'join', pseudo: player.pseudo, ts: Date.now() });

    if (s.status === 'paused') {
      const connectedCount = Object.values(s.players).filter(p => p.connected).length;
      if (connectedCount > 0) s.status = 'playing';
    }
    this.broadcast();
    return true;
  }

  kickPlayer(playerId: string) {
    const player = this.state.players[playerId];
    if (!player) return;
    // Cancel cleanup timer and rate limiter
    const timer = this.cleanupTimers.get(player.token);
    if (timer) { clearTimeout(timer); this.cleanupTimers.delete(player.token); }
    this.inputRateLimiter.delete(playerId);
    this.onChatEvent?.({ type: 'kick', pseudo: player.pseudo, ts: Date.now() });
    delete this.state.players[playerId];
    this.broadcast();
  }

  listMaps(): string[] {
    return fs
      .readdirSync(MAPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  // ---- Private helpers ----

  /** Sliding-window rate limiter: true if this player is over the limit. */
  private isRateLimited(id: string): boolean {
    const now = Date.now();
    if (!this.inputRateLimiter.has(id)) this.inputRateLimiter.set(id, []);
    const times = this.inputRateLimiter.get(id)!;
    // Remove timestamps outside the current window
    const cutoff = now - INPUT_RATE_WINDOW_MS;
    let i = 0;
    while (i < times.length && times[i] < cutoff) i++;
    if (i > 0) times.splice(0, i);
    if (times.length >= INPUT_RATE_MAX) return true;
    times.push(now);
    return false;
  }

  private broadcast() {
    this.onBroadcast?.(this.getPublicState());
  }
}

export const gameStore = new GameStore();
