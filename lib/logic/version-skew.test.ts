import { describe, expect, it } from 'vitest';
import { ACTION_MISMATCH, parseVersionResponse, skewAction } from './version-skew';

const base = { clientVersion: 'v1', serverVersion: 'v2' as string | null, unsafe: false, reloadedFor: null as string | null };

describe('skewAction', () => {
  it('does nothing for dev clients, unknown or equal server versions', () => {
    expect(skewAction({ ...base, clientVersion: 'dev' })).toBe('none');
    expect(skewAction({ ...base, serverVersion: null })).toBe('none');
    expect(skewAction({ ...base, serverVersion: 'v1' })).toBe('none');
  });

  it('reloads when safe, prompts when unsafe or already reloaded for that version', () => {
    expect(skewAction(base)).toBe('reload');
    expect(skewAction({ ...base, unsafe: true })).toBe('prompt');
    expect(skewAction({ ...base, reloadedFor: 'v2' })).toBe('prompt');
    expect(skewAction({ ...base, reloadedFor: 'old' })).toBe('reload');
    expect(skewAction({ ...base, serverVersion: ACTION_MISMATCH })).toBe('reload');
  });
});

describe('parseVersionResponse', () => {
  it('reads a non-empty version string only', () => {
    expect(parseVersionResponse({ version: 'dpl_1' })).toBe('dpl_1');
    for (const bad of [{ version: '' }, {}, null, 'x', { version: 3 }]) expect(parseVersionResponse(bad)).toBeNull();
  });
});
