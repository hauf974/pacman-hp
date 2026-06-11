import {
  aggregateDemocracy,
  buildVoteTally,
  canMove,
  applyTunnel,
  dirDelta,
  isWalkable,
} from '../src/server/gameEngine';
import { TimedInput, MapData } from '../src/shared/types';

// Minimal map for testing
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

describe('aggregateDemocracy', () => {
  const now = Date.now();

  function input(dir: any, msAgo: number): TimedInput {
    return { dir, ts: now - msAgo, playerId: 'p1' };
  }

  test('majority wins', () => {
    const inputs: TimedInput[] = [
      input('up', 100), input('up', 200), input('down', 300), input('right', 400),
    ];
    const result = aggregateDemocracy(inputs, 5000, now);
    expect(result).toBe('up');
  });

  test('returns null if no inputs in window', () => {
    const inputs: TimedInput[] = [input('up', 10000)];
    const result = aggregateDemocracy(inputs, 3000, now);
    expect(result).toBeNull();
  });

  test('tie returns one of the tied directions', () => {
    const inputs: TimedInput[] = [input('up', 100), input('down', 200)];
    const result = aggregateDemocracy(inputs, 5000, now);
    expect(['up', 'down']).toContain(result);
  });

  test('empty inputs returns null', () => {
    expect(aggregateDemocracy([], 3000, now)).toBeNull();
  });
});

describe('buildVoteTally', () => {
  const now = Date.now();
  function input(dir: any, msAgo: number): TimedInput {
    return { dir, ts: now - msAgo, playerId: 'p1' };
  }

  test('counts votes correctly', () => {
    const inputs: TimedInput[] = [
      input('up', 100), input('up', 200), input('left', 300),
    ];
    const tally = buildVoteTally(inputs, 5000, now);
    expect(tally.up).toBe(2);
    expect(tally.left).toBe(1);
    expect(tally.down).toBe(0);
    expect(tally.right).toBe(0);
  });

  test('ignores inputs outside window', () => {
    const inputs: TimedInput[] = [input('up', 100), input('up', 10000)];
    const tally = buildVoteTally(inputs, 3000, now);
    expect(tally.up).toBe(1);
  });
});

describe('canMove / isWalkable / applyTunnel', () => {
  // 3x3 grid: wall border, corridor center
  const cells = [
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1],
  ];
  const map = makeMap(cells);

  test('cannot move into wall', () => {
    expect(canMove(map, 1, 1, 'up')).toBe(false);
    expect(canMove(map, 1, 1, 'down')).toBe(false);
    expect(canMove(map, 1, 1, 'left')).toBe(false);
    expect(canMove(map, 1, 1, 'right')).toBe(false);
  });

  // Open corridor map
  const open = makeMap([
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);

  test('can move in open map', () => {
    expect(canMove(open, 1, 1, 'up')).toBe(true);
    expect(canMove(open, 1, 1, 'down')).toBe(true);
    expect(canMove(open, 1, 1, 'left')).toBe(true);
    expect(canMove(open, 1, 1, 'right')).toBe(true);
  });

  test('tunnel wraps horizontally', () => {
    const tunnelMap = makeMap(
      [[0, 0, 0]],
      [0], // horizontal tunnel on row 0
    );
    // Moving left from c=0 wraps to c=2
    const result = applyTunnel(tunnelMap, 0, -1);
    expect(result).toEqual({ r: 0, c: 2 });
    // Moving right from c=2 wraps to c=0
    const result2 = applyTunnel(tunnelMap, 0, 3);
    expect(result2).toEqual({ r: 0, c: 0 });
  });

  test('tunnel wraps vertically', () => {
    const tunnelMap = makeMap(
      [[0], [0], [0]],
      [],
      [0], // vertical tunnel on col 0
    );
    const result = applyTunnel(tunnelMap, -1, 0);
    expect(result).toEqual({ r: 2, c: 0 });
    const result2 = applyTunnel(tunnelMap, 3, 0);
    expect(result2).toEqual({ r: 0, c: 0 });
  });

  test('no tunnel when row not in list', () => {
    const tunnelMap = makeMap(
      [[0, 0, 0], [0, 0, 0]],
      [0], // only row 0
    );
    // Row 1 has no tunnel
    const result = applyTunnel(tunnelMap, 1, -1);
    expect(result).toEqual({ r: 1, c: -1 });
  });
});

describe('dirDelta', () => {
  test('up decrements row', () => expect(dirDelta('up')).toEqual({ dr: -1, dc: 0 }));
  test('down increments row', () => expect(dirDelta('down')).toEqual({ dr: 1, dc: 0 }));
  test('left decrements col', () => expect(dirDelta('left')).toEqual({ dr: 0, dc: -1 }));
  test('right increments col', () => expect(dirDelta('right')).toEqual({ dr: 0, dc: 1 }));
});
