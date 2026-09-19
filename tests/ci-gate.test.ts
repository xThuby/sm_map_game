import { describe, it, expect } from 'vitest';

// Temporary: proves a red suite blocks the Pages deploy. Reverted immediately after.
describe('ci gate', () => {
  it('fails on purpose', () => {
    expect('deploy').toBe('blocked');
  });
});
