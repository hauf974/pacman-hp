export type Direction = 'up' | 'down' | 'left' | 'right';

export type GameStatus =
  | 'lobby'
  | 'playing'
  | 'paused'
  | 'levelTransition'
  | 'gameover'
  | 'won';

export type ControlMode = 'democracy' | 'chaos';
export type ObjectiveMode = 'room' | 'collect';

// cells: 0=corridor 1=wall 2=room 3=avatar-start 4=pursuer-spawn
export type CellType = 0 | 1 | 2 | 3 | 4;

export interface MapData {
  name: string;
  width: number;
  height: number;
  cells: CellType[][];
  avatarStart: { r: number; c: number };
  pursuerSpawns: { r: number; c: number }[];
  room: { r: number; c: number }[];
  /** Single entry cell into the room — only this cell triggers level completion. */
  roomDoor?: { r: number; c: number };
  tunnels: { horizontal: number[]; vertical: number[] };
  createdAt?: string;
  updatedAt?: string;
  seed?: number;
  note?: string;
}

export interface Avatar {
  r: number;
  c: number;
  dir: Direction;
  queuedDir: Direction | null;
  speed: number; // cells per second
}

export type PursuerType = 'rusard' | 'missteigne' | 'rogue' | 'peeves' | 'baronsanglant';

export interface Pursuer {
  id: string;
  type: PursuerType;
  r: number;
  c: number;
  dir: Direction;
  speed: number;
}

export interface Wand {
  r: number;
  c: number;
  collected: boolean;
}

export interface Player {
  id: string;
  pseudo: string;
  connected: boolean;
  lastInput: Direction | null;
  lastSeen: number;
  token: string;
}

export interface TimedInput {
  dir: Direction;
  ts: number;
  playerId: string;
}

export interface VoteTally {
  up: number;
  down: number;
  left: number;
  right: number;
}

export interface GameSettings {
  tempo: 'posed' | 'anime' | 'frenetique';
  atmosphere: 'parchemin' | 'chandelle' | 'sortilege';
  titleFont: string;
  footprints: boolean;
  pursuerSpeed: number;
  avatarSpeed: number;
  voteWindowSec: number;
  wandCountPerLevel: number;
  /** If false, avatar only moves one step per played direction (no continuous movement). */
  autoMove: boolean;
  /** Level to start from when a new game begins (1–5). */
  startingLevel: number;
  /** Avatar sprite: 'hat' = sorcerer hat (default), 'hp' = hp.png image. */
  avatarIcon: 'hat' | 'hp';
}

export interface GameState {
  status: GameStatus;
  mode: ControlMode;
  objectiveMode: ObjectiveMode;
  level: number;
  lives: number;
  activeMap: MapData;
  avatar: Avatar;
  pursuers: Pursuer[];
  wands: Wand[];
  players: Record<string, Player>;
  inputBuffer: TimedInput[];
  chaosQueue: Direction[];
  voteTally: VoteTally;
  settings: GameSettings;
  toursJoues: number;
}

export interface MapGenParams {
  width: number;
  height: number;
  /** Wall density 0.1–0.8 (higher = more walls / fewer loops). */
  density: number;
  /** Number of pursuer spawn points to place (1–5). */
  spawnCount: number;
  seed?: number;
}

export interface MapValidation {
  valid: boolean;
  errors: string[];
}

// Socket.IO event types
export interface ServerToClientEvents {
  'state:update': (state: PublicGameState) => void;
  'players:update': (players: PublicPlayer[]) => void;
  'chat:event': (event: ChatEvent) => void;
  'level:transition': (level: number) => void;
  'game:over': () => void;
  'game:won': () => void;
  'player:welcome': (data: { id: string; token: string; mode: ControlMode }) => void;
  'admin:error': (msg: string) => void;
}

export interface ClientToServerEvents {
  'player:join': (data: { pseudo: string }) => void;
  'player:input': (data: { dir: Direction }) => void;
  'player:reconnect': (data: { token: string }) => void;
  'admin:auth': (data: { secret: string }) => void;
  'admin:start': () => void;
  'admin:pause': () => void;
  'admin:reset': () => void;
  'admin:setMode': (data: { mode: ControlMode }) => void;
  'admin:setSettings': (data: Partial<GameSettings>) => void;
  'admin:kick': (data: { playerId: string }) => void;
  'admin:forceLevel': (data: { level: number }) => void;
  'admin:forceNextLevel': () => void;
  'admin:forceGameOver': () => void;
  'admin:forceWin': () => void;
  // Map editor (admin) — all use ack callbacks
  'map:list': (cb: (names: string[]) => void) => void;
  'map:get': (data: { name: string }, cb: (map: MapData | null) => void) => void;
  'map:save': (data: { map: MapData }, cb: (res: { ok: boolean; name?: string; errors?: string[] }) => void) => void;
  'map:duplicate': (data: { name: string }, cb: (res: { ok: boolean; name?: string; error?: string }) => void) => void;
  'map:delete': (data: { name: string }, cb: (res: { ok: boolean; error?: string }) => void) => void;
  'map:generate': (data: MapGenParams, cb: (res: { ok: boolean; map?: MapData; error?: string }) => void) => void;
  'map:validate': (data: { map: MapData }, cb: (res: MapValidation) => void) => void;
  'map:setActive': (data: { name: string }, cb: (res: { ok: boolean; error?: string }) => void) => void;
}

export interface PublicPlayer {
  id: string;
  pseudo: string;
  connected: boolean;
  lastInput: Direction | null;
}

export interface PublicGameState {
  status: GameStatus;
  mode: ControlMode;
  objectiveMode: ObjectiveMode;
  level: number;
  lives: number;
  mapName: string;
  mapWidth: number;
  mapHeight: number;
  mapCells: CellType[][];
  mapTunnels: { horizontal: number[]; vertical: number[] };
  mapRoomDoor: { r: number; c: number } | null;
  avatar: Avatar;
  pursuers: Pursuer[];
  wands: Wand[];
  players: PublicPlayer[];
  voteTally: VoteTally;
  settings: GameSettings;
  toursJoues: number;
  wandTotal: number;
  wandCollected: number;
}

export interface ChatEvent {
  type: 'input' | 'join' | 'leave' | 'kick';
  pseudo: string;
  dir?: Direction;
  ts: number;
}
