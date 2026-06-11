import * as fs from 'fs';
import * as path from 'path';
import {
  GameState,
  GameStatus,
  MapData,
  GameSettings,
  PublicGameState,
  PublicPlayer,
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
} from './gameEngine';

const MAPS_DIR = path.join(process.cwd(), 'data', 'maps');
const DEFAULT_SETTINGS: GameSettings = {
  tempo: 'anime',
  atmosphere: 'parchemin',
  titleFont: 'UnifrakturCook',
  footprints: false,
  pursuerSpeed: 3,
  avatarSpeed: 4,
  voteWindowSec: 3,
  wandCountPerLevel: 3,
};

function loadMap(name: string): MapData {
  const file = path.join(MAPS_DIR, `${name}.json`);
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as MapData;
}

function createInitialState(): GameState {
  const map = loadMap('pacman');
  return {
    status: 'lobby',
    mode: 'democracy',
    objectiveMode: 'room',
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

class GameStore {
  private state: GameState;
  private avatarTickAccum = 0;
  private pursuerTickAccum = 0;
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

  constructor() {
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

      if (s.mode === 'democracy') {
        const dir = aggregateDemocracy(s.inputBuffer, s.settings.voteWindowSec * 1000, now);
        if (dir) {
          applyDirectionToAvatar(s, dir);
          s.toursJoues++;
        }
        s.voteTally = buildVoteTally(s.inputBuffer, s.settings.voteWindowSec * 1000, now);
      } else {
        // Chaos: apply next queued direction
        if (s.chaosQueue.length > 0) {
          const dir = s.chaosQueue.shift()!;
          applyDirectionToAvatar(s, dir);
          s.toursJoues++;
        }
        s.voteTally = buildVoteTally(s.inputBuffer, s.settings.voteWindowSec * 1000, now);
      }

      tickAvatar(s);

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

      // Check collisions
      if (checkCollisions(s)) {
        s.lives--;
        if (s.lives <= 0) {
          s.status = 'gameover';
          this.broadcast();
          this.onGameOver?.();
          return;
        }
        // Reset positions
        s.avatar.r = s.activeMap.avatarStart.r;
        s.avatar.c = s.activeMap.avatarStart.c;
        s.avatar.queuedDir = null;
        s.pursuers = spawnPursuers(s.activeMap, s.level, s.settings.pursuerSpeed);
      }
    }

    // Tick pursuers
    this.pursuerTickAccum += dtMs;
    if (this.pursuerTickAccum >= pursuerPeriodMs) {
      this.pursuerTickAccum -= pursuerPeriodMs;
      for (const pursuer of s.pursuers) {
        tickPursuer(s.activeMap, pursuer, s.avatar);
      }
      // Check collisions after pursuer move
      if (checkCollisions(s)) {
        s.lives--;
        if (s.lives <= 0) {
          s.status = 'gameover';
          this.broadcast();
          this.onGameOver?.();
          return;
        }
        s.avatar.r = s.activeMap.avatarStart.r;
        s.avatar.c = s.activeMap.avatarStart.c;
        s.avatar.queuedDir = null;
        s.pursuers = spawnPursuers(s.activeMap, s.level, s.settings.pursuerSpeed);
      }
    }

    this.broadcast();
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
      s.level = 1;
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
    this.state = createInitialState();
    this.avatarTickAccum = 0;
    this.pursuerTickAccum = 0;
    this.broadcast();
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
    // Resume only if paused due to zero players (not an admin pause)
    if (s.status === 'paused') {
      s.status = 'playing';
    }
    this.broadcast();
  }

  playerInput(id: string, dir: Direction) {
    const s = this.state;
    const player = s.players[id];
    if (!player || s.status !== 'playing') return;

    player.lastInput = dir;
    player.lastSeen = Date.now();

    const timedInput: TimedInput = { dir, ts: Date.now(), playerId: id };
    s.inputBuffer.push(timedInput);

    if (s.mode === 'chaos') {
      s.chaosQueue.push(dir);
    }

    // Keep buffer bounded
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

    // Rebind socket id
    delete s.players[player.id];
    player.id = socketId;
    player.connected = true;
    player.lastSeen = Date.now();
    s.players[socketId] = player;

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

  private broadcast() {
    this.onBroadcast?.(this.getPublicState());
  }
}

export const gameStore = new GameStore();
