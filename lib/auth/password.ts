import { hmacDigest } from '@/lib/auth/session';
import { constantTimeEqual } from '@/lib/auth/bearer';

/**
 * Constant-time password check. Both sides are HMAC'd with `secret` first so the
 * final comparison is always fixed-length (32-byte digest), never leaking the
 * real password's length through a variable-length constant-time compare.
 */
export async function checkPassword(input: string, expected: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmacDigest(secret, input), hmacDigest(secret, expected)]);
  return constantTimeEqual(a, b);
}
