import { randomInt, randomChoice, weightedRandom } from './random.util';
import { checkProbability } from './probability.util';
import { clamp, distance, inRange } from './math.util';
import { generateOrderNo } from './id.util';
import { getTodayStr, getYesterdayStr, isSameDay } from './time.util';

describe('random.util', () => {
  it('randomInt should return value within range', () => {
    const result = randomInt(1, 10);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(10);
  });

  it('randomChoice should return element from array', () => {
    const arr = ['a', 'b', 'c'];
    const result = randomChoice(arr);
    expect(arr).toContain(result);
  });

  it('weightedRandom should respect weights', () => {
    const items = [
      { value: 'rare', weight: 0 },
      { value: 'common', weight: 100 },
    ];
    const result = weightedRandom(items);
    expect(result.value).toBe('common');
  });
});

describe('probability.util', () => {
  it('checkProbability with rate 1 should always return true', () => {
    expect(checkProbability(1)).toBe(true);
  });

  it('checkProbability with rate 0 should always return false', () => {
    expect(checkProbability(0)).toBe(false);
  });
});

describe('math.util', () => {
  it('clamp should constrain value', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('distance should calculate 2D distance', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });

  it('inRange should check radius', () => {
    expect(inRange(0, 0, 1, 1, 2)).toBe(true);
    expect(inRange(0, 0, 10, 10, 2)).toBe(false);
  });
});

describe('id.util', () => {
  it('generateOrderNo should return unique string', () => {
    const a = generateOrderNo();
    const b = generateOrderNo();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe('time.util', () => {
  it('getTodayStr should return YYYY-MM-DD', () => {
    const result = getTodayStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getYesterdayStr should be one day before today', () => {
    const today = getTodayStr();
    const yesterday = getYesterdayStr();
    expect(yesterday).not.toBe(today);
  });

  it('isSameDay should compare dates', () => {
    const d1 = new Date('2026-07-23T10:00:00');
    const d2 = new Date('2026-07-23T23:00:00');
    const d3 = new Date('2026-07-24T00:00:00');
    expect(isSameDay(d1, d2)).toBe(true);
    expect(isSameDay(d1, d3)).toBe(false);
  });
});
