import { computeDoudizhuLadderDelta } from '../ladder/ladder.service';

describe('doudizhu ladder delta (3-party)', () => {
  it('winner gains base 25 + streak bonus (capped at streak 6)', () => {
    expect(computeDoudizhuLadderDelta(true, true, 0)).toBe(25);
    expect(computeDoudizhuLadderDelta(false, true, 0)).toBe(25);
    expect(computeDoudizhuLadderDelta(true, true, 3)).toBe(40);
    expect(computeDoudizhuLadderDelta(true, true, 10)).toBe(55); // 25 + 30
  });

  it('landlord loss -40, farmer loss -18', () => {
    expect(computeDoudizhuLadderDelta(true, false, 5)).toBe(-40);
    expect(computeDoudizhuLadderDelta(false, false, 5)).toBe(-18);
  });
});
