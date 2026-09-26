import { describe, expect, it } from 'vitest';
import { encodeProjectDir, isWslPath, toWslPath } from './project-dir.mjs';

describe('encodeProjectDir', () => {
  it('matches the real ~/.claude/projects dir name for a Windows path with Korean user dir', () => {
    expect(encodeProjectDir('C:\\Users\\민수\\Desktop\\Work\\trading-system')).toBe(
      'C--Users----Desktop-Work-trading-system'
    );
  });

  it('matches the real dir name for a nested Windows path', () => {
    expect(encodeProjectDir('C:\\Users\\민수\\Desktop\\Work\\traicer-corp\\flow-sorter')).toBe(
      'C--Users----Desktop-Work-traicer-corp-flow-sorter'
    );
  });

  it('matches the real WSL-side encoding for a /home path', () => {
    expect(encodeProjectDir('/home/minsu/projects/amgi')).toBe('-home-minsu-projects-amgi');
  });

  it('matches the real WSL-side encoding for the /mnt/c form of a Windows path', () => {
    expect(encodeProjectDir('/mnt/c/Users/민수/Desktop/Work/trading-system')).toBe(
      '-mnt-c-Users----Desktop-Work-trading-system'
    );
  });
});

describe('isWslPath / toWslPath', () => {
  it('recognizes /home and ~ paths as WSL, Windows drive paths as not', () => {
    expect(isWslPath('/home/minsu/projects/amgi')).toBe(true);
    expect(isWslPath('~/projects/amgi')).toBe(true);
    expect(isWslPath('C:\\Users\\a\\b')).toBe(false);
  });

  it('converts a Windows path to /mnt/c form', () => {
    expect(toWslPath('C:\\Users\\민수\\Desktop\\Work\\trading-system')).toBe(
      '/mnt/c/Users/민수/Desktop/Work/trading-system'
    );
  });

  it('leaves an already-WSL path unchanged', () => {
    expect(toWslPath('/home/minsu/projects/amgi')).toBe('/home/minsu/projects/amgi');
  });
});
