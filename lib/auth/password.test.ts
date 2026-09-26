import { describe, expect, it } from 'vitest';
import { checkPassword } from '@/lib/auth/password';

describe('checkPassword', () => {
  it('true when input matches expected', async () => {
    expect(await checkPassword('hunter2', 'hunter2', 'secret')).toBe(true);
  });

  it('false when input does not match', async () => {
    expect(await checkPassword('wrong', 'hunter2', 'secret')).toBe(false);
  });

  it('is case-sensitive', async () => {
    expect(await checkPassword('Hunter2', 'hunter2', 'secret')).toBe(false);
  });
});
