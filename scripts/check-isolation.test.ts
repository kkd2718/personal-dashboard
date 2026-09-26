import { describe, expect, it } from 'vitest';
import { checkIsolation } from './check-isolation.mjs';

describe('checkIsolation', () => {
  it('finds no personal identifiers in tracked files outside data/ and docs/', () => {
    const violations = checkIsolation();
    expect(violations).toEqual([]);
  });
});
