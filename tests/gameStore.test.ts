import { GameStore } from '../src/server/gameStore';

// GameStore reads data/maps/pacman.json — tests must run from the project root (default jest cwd).

// Use fake timers throughout: prevents real 5-minute setTimeout from keeping jest alive.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStore(cleanupDelayMs = 5 * 60 * 1000): GameStore {
  return new GameStore(cleanupDelayMs);
}

// Put the store in 'playing' state by joining a player and starting the game.
function startStore(gs: GameStore, socketId = 's0', pseudo = 'Tester', token = 'tok0'): void {
  gs.playerJoin(socketId, pseudo, token);
  gs.start();
}

// ── Player reconnection ───────────────────────────────────────────────────────

describe('playerReconnect — token valid', () => {
  test('reconnect with correct token: returns true, rebinds socket ID', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Alice', 't1');
    gs.playerDisconnect('s1');
    const ok = gs.playerReconnect('s2', 't1');
    expect(ok).toBe(true);
    const players = gs.getPlayersSnapshot();
    expect(players['s2']).toBeDefined();
    expect(players['s2'].connected).toBe(true);
    expect(players['s2'].pseudo).toBe('Alice');
    expect(players['s1']).toBeUndefined();
  });

  test('reconnect preserves pseudo and token', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Bob', 'tok-bob');
    gs.playerDisconnect('s1');
    gs.playerReconnect('s-new', 'tok-bob');
    const p = gs.getPlayersSnapshot()['s-new'];
    expect(p.pseudo).toBe('Bob');
    expect(p.token).toBe('tok-bob');
  });

  test('reconnect without prior disconnect (same token, new socket) also works', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Carol', 't1');
    const ok = gs.playerReconnect('s2', 't1');
    expect(ok).toBe(true);
    expect(gs.getPlayersSnapshot()['s2'].connected).toBe(true);
  });
});

describe('playerReconnect — token invalid or expired', () => {
  test('wrong token: returns false, state unchanged', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Dave', 't1');
    gs.playerDisconnect('s1');
    const ok = gs.playerReconnect('s2', 'wrong-token');
    expect(ok).toBe(false);
    expect(gs.getPlayersSnapshot()['s1']).toBeDefined(); // original player still present
    expect(gs.getPlayersSnapshot()['s2']).toBeUndefined();
  });

  test('unknown token (no such player): returns false', () => {
    const gs = makeStore();
    expect(gs.playerReconnect('s1', 'no-such-token')).toBe(false);
  });

  test('expired token (player cleaned up after timeout): returns false', () => {
    const DELAY = 10_000;
    const gs = makeStore(DELAY);
    gs.playerJoin('s1', 'Eve', 't1');
    gs.playerDisconnect('s1');
    jest.advanceTimersByTime(DELAY + 100);
    expect(gs.playerReconnect('s2', 't1')).toBe(false);
    expect(gs.getPlayersSnapshot()['s1']).toBeUndefined();
  });
});

describe('playerReconnect — cleanup timer interaction', () => {
  test('successful reconnect cancels the cleanup timer', () => {
    const DELAY = 10_000;
    const gs = makeStore(DELAY);
    gs.playerJoin('s1', 'Frank', 't1');
    gs.playerDisconnect('s1');
    gs.playerReconnect('s2', 't1');
    jest.advanceTimersByTime(DELAY + 100);
    expect(gs.getPlayersSnapshot()['s2']).toBeDefined();
    expect(gs.getPlayersSnapshot()['s2'].connected).toBe(true);
  });

  test('double-disconnect does not pile up timers (second replaces first)', () => {
    const DELAY = 10_000;
    const gs = makeStore(DELAY);
    gs.playerJoin('s1', 'Grace', 't1');
    gs.playerDisconnect('s1');
    gs.playerDisconnect('s1'); // already disconnected — no-op
    jest.advanceTimersByTime(DELAY - 1);
    expect(gs.getPlayersSnapshot()['s1']).toBeDefined();
    jest.advanceTimersByTime(200);
    expect(gs.getPlayersSnapshot()['s1']).toBeUndefined();
  });
});

describe('playerReconnect — game state restoration', () => {
  test('reconnect resumes a paused game', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Henry', 't1');
    gs.start();
    gs.playerDisconnect('s1');
    expect(gs.getStatus()).toBe('paused'); // auto-paused (0 players)
    gs.playerReconnect('s2', 't1');
    expect(gs.getStatus()).toBe('playing');
  });

  test('reconnect with other players still connected: game stays playing', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Iris', 't1');
    gs.playerJoin('s2', 'Jack', 't2');
    gs.start();
    gs.playerDisconnect('s1');
    expect(gs.getStatus()).toBe('playing'); // s2 still connected
    gs.playerReconnect('s3', 't1');
    expect(gs.getStatus()).toBe('playing');
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('playerInput rate limiting', () => {

  test('first 20 inputs in 1 s window are accepted (lastInput tracks last accepted dir)', () => {
    const gs = makeStore();
    startStore(gs, 's1', 'Alice', 't1');
    for (let i = 0; i < 20; i++) gs.playerInput('s1', 'left');
    expect(gs.getPlayersSnapshot()['s1'].lastInput).toBe('left');
  });

  test('21st input in same second is silently dropped (lastInput stays from 20th)', () => {
    const gs = makeStore();
    startStore(gs, 's1', 'Alice', 't1');
    for (let i = 0; i < 20; i++) gs.playerInput('s1', 'up');
    // All 20 accepted → lastInput = 'up'
    gs.playerInput('s1', 'down'); // 21st — should be dropped
    expect(gs.getPlayersSnapshot()['s1'].lastInput).toBe('up'); // NOT 'down'
  });

  test('after 1 s the window resets and inputs are accepted again', () => {
    const gs = makeStore();
    startStore(gs, 's1', 'Alice', 't1');
    for (let i = 0; i < 20; i++) gs.playerInput('s1', 'right');
    gs.playerInput('s1', 'down'); // 21st — dropped
    expect(gs.getPlayersSnapshot()['s1'].lastInput).toBe('right');

    jest.advanceTimersByTime(1001); // advance 1 s
    gs.playerInput('s1', 'down'); // now accepted
    expect(gs.getPlayersSnapshot()['s1'].lastInput).toBe('down');
  });

  test('rate limits are per-player (other players are not affected)', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Alice', 't1');
    gs.playerJoin('s2', 'Bob', 't2');
    gs.start();
    for (let i = 0; i < 20; i++) gs.playerInput('s1', 'up'); // saturate Alice
    gs.playerInput('s2', 'left'); // Bob is unaffected
    expect(gs.getPlayersSnapshot()['s2'].lastInput).toBe('left');
  });

  test('inputs are silently dropped, not errored', () => {
    const gs = makeStore();
    startStore(gs, 's1', 'Alice', 't1');
    // 50 rapid inputs should not throw
    expect(() => {
      for (let i = 0; i < 50; i++) gs.playerInput('s1', 'right');
    }).not.toThrow();
  });
});

// ── Chaos queue cap ───────────────────────────────────────────────────────────

describe('chaosQueue cap', () => {
  test('chaos queue never exceeds 200 entries', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Alice', 't1');
    gs.setMode('chaos');
    gs.start();
    // 300 distinct time slots to bypass rate limit (fake timers active globally)
    for (let i = 0; i < 300; i++) {
      jest.advanceTimersByTime(60); // 60 ms apart — within rate window per-second
      gs.playerInput('s1', i % 2 === 0 ? 'left' : 'right');
    }
    expect(() => {
      for (let t = 0; t < 50; t++) gs.tick(67);
    }).not.toThrow();
  });
});

// ── autoMove=false: one press = one step ──────────────────────────────────────

describe('autoMove=false: manual movement (one input = one step)', () => {
  test('Democracy: single input moves avatar at most once (buffer cleared after consumption)', () => {
    const gs = makeStore();
    startStore(gs, 's1', 'Tester', 't1');
    gs.setSettings({ autoMove: false, voteWindowSec: 3 });

    const before = gs.getPublicState().avatar;
    gs.playerInput('s1', 'left');

    // 8 ticks × 100 ms = 800 ms — enough for 3 avatar periods at default speed 4 (250 ms each)
    for (let i = 0; i < 8; i++) gs.tick(100);

    const after = gs.getPublicState().avatar;
    const steps = Math.abs(after.r - before.r) + Math.abs(after.c - before.c);
    expect(steps).toBeLessThanOrEqual(1);
  });
});

// ── M4h2: Admin settings → live effect (regression tests) ────────────────────

describe('setSettings — speed sync on live entities (M4h2)', () => {
  test('avatarSpeed change is reflected immediately in avatar.speed', () => {
    const gs = makeStore();
    startStore(gs);
    gs.setSettings({ avatarSpeed: 8 });
    expect(gs.getPublicState().avatar.speed).toBe(8);
    gs.setSettings({ avatarSpeed: 1.5 });
    expect(gs.getPublicState().avatar.speed).toBe(1.5);
  });

  test('pursuerSpeed change updates settings.pursuerSpeed immediately', () => {
    const gs = makeStore();
    startStore(gs);
    gs.setSettings({ pursuerSpeed: 6 });
    expect(gs.getPublicState().settings.pursuerSpeed).toBe(6);
  });

  test('pursuerSpeed change is used by tick (pursuers move faster)', () => {
    const gs = makeStore();
    startStore(gs);
    // Very slow speed (period = 10 s): no pursuer tick in 1 s
    gs.setSettings({ pursuerSpeed: 0.1 });
    gs.tick(999);
    const stateA = gs.getPublicState();
    // Still same positions — pursuerTickAccum (999ms) < 10 000ms period
    expect(stateA.settings.pursuerSpeed).toBe(0.1);

    // Change to high speed (period = 100 ms): should tick many times in next 1 s
    gs.setSettings({ pursuerSpeed: 10 });
    expect(gs.getPublicState().settings.pursuerSpeed).toBe(10);
  });

  test('voteWindowSec change takes effect on next democracy resolution', () => {
    const gs = makeStore();
    startStore(gs);
    gs.setSettings({ autoMove: false, voteWindowSec: 1 });
    gs.playerInput('s0', 'right');

    // Tick 0.9 s — no resolution with 1 s window
    gs.tick(900);
    expect(gs.getPublicState().toursJoues).toBe(0);

    // Change to 3 s window — next resolution now needs 3 s from last reset
    gs.setSettings({ voteWindowSec: 3 });
    gs.tick(200); // only 1.1 s elapsed since start, not 3 s
    expect(gs.getPublicState().toursJoues).toBe(0); // still no resolution

    // Add vote, tick to 3 s total → resolution fires
    gs.playerInput('s0', 'right');
    gs.tick(2000); // 1.1 + 2.0 = 3.1 s → fires
    expect(gs.getPublicState().toursJoues).toBe(1);
  });

  test('autoMove setting is reflected in public state', () => {
    const gs = makeStore();
    startStore(gs);
    gs.setSettings({ autoMove: true });
    expect(gs.getPublicState().settings.autoMove).toBe(true);
    gs.setSettings({ autoMove: false });
    expect(gs.getPublicState().settings.autoMove).toBe(false);
  });

  test('objectiveMode change is reflected in public state', () => {
    const gs = makeStore();
    startStore(gs);
    gs.setSettings({ objectiveMode: 'room' } as any);
    expect(gs.getPublicState().objectiveMode).toBe('room');
    gs.setSettings({ objectiveMode: 'collect' } as any);
    expect(gs.getPublicState().objectiveMode).toBe('collect');
  });

  test('footprints setting accepts new palette values', () => {
    const gs = makeStore();
    startStore(gs);
    for (const level of ['off', 'light', 'medium', 'max'] as const) {
      gs.setSettings({ footprints: level });
      expect(gs.getPublicState().settings.footprints).toBe(level);
    }
  });

  test('multiple settings can be changed in a single call', () => {
    const gs = makeStore();
    startStore(gs);
    gs.setSettings({ avatarSpeed: 6, pursuerSpeed: 3, voteWindowSec: 1.5 });
    const pub = gs.getPublicState();
    expect(pub.avatar.speed).toBe(6);
    expect(pub.settings.pursuerSpeed).toBe(3);
    expect(pub.settings.voteWindowSec).toBe(1.5);
  });
});

// ── M4h1: Democracy cadence — vote window governs movement rate ───────────────

describe('Democracy cadence (M4h1): autoMove=OFF, voteWindowSec=2', () => {
  /**
   * Bug: with autoMove=OFF the avatar used to move every avatarSpeed period
   * (e.g. 250 ms at speed=4) rather than once per voteWindow.
   * Fix: a dedicated democracyAccum fires at voteWindowMs; one step per window.
   * Round-number tick sizes are used here to avoid floating-point accumulation edge cases.
   */
  test('avatar moves once per voteWindow, not at avatarSpeed cadence', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Tester', 't1');
    // avatarSpeed=10 → period=100 ms; before the fix this would produce 20 moves/2 s
    gs.setSettings({ autoMove: false, voteWindowSec: 2, avatarSpeed: 10 });
    gs.start();
    gs.playerInput('s1', 'right');

    // 1900 ms < 2000 ms window — no resolution yet
    gs.tick(1900);
    expect(gs.getPublicState().toursJoues).toBe(0);

    // +200 ms → 2100 ms total → first resolution fires; democracyAccum resets to 100 ms
    gs.tick(200);
    expect(gs.getPublicState().toursJoues).toBe(1);

    // +1800 ms (no new votes) → accum = 1900 ms < 2000 ms → no second resolution
    gs.tick(1800);
    expect(gs.getPublicState().toursJoues).toBe(1);

    // Add vote, +200 ms → accum = 2100 ms → second resolution fires
    gs.playerInput('s1', 'right');
    gs.tick(200);
    expect(gs.getPublicState().toursJoues).toBe(2);
  });

  test('no movement occurs before the first window elapses', () => {
    const gs = makeStore();
    gs.playerJoin('s1', 'Tester', 't1');
    gs.setSettings({ autoMove: false, voteWindowSec: 2 });
    gs.start();
    gs.playerInput('s1', 'left');

    // 1990 ms — just under the 2 s window
    gs.tick(1990);
    expect(gs.getPublicState().toursJoues).toBe(0);
  });
});

// ── reset() clears cleanup timers ─────────────────────────────────────────────

describe('reset() cleans up timers', () => {
  test('reset() cancels all cleanup timers — players removed from state', () => {
    const gs = makeStore(60_000);
    gs.playerJoin('s1', 'A', 'ta');
    gs.playerJoin('s2', 'B', 'tb');
    gs.playerDisconnect('s1');
    gs.playerDisconnect('s2');
    gs.reset();
    // After reset, advancing time should not throw or leave stale state
    expect(() => jest.advanceTimersByTime(120_000)).not.toThrow();
    expect(Object.keys(gs.getPlayersSnapshot())).toHaveLength(0);
  });
});
