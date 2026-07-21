import { describe, expect, it } from 'vitest';
import { LatestRequestGateV2 } from '../domain/latestRequestGateV2';

describe('latest auth request gate', () => {
  it('invalidates older overlapping requests and explicit account transitions', () => {
    const gate = new LatestRequestGateV2();
    const first = gate.begin();
    const second = gate.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);

    gate.invalidate();
    expect(second()).toBe(false);
  });
});
