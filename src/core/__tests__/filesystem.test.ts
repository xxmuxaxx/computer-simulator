import { describe, expect, it } from 'vitest';
import { SystemError } from '../errors';
import { VirtualFileSystem } from '../filesystem/VirtualFileSystem';

function makeFs(capacityBytes?: number): VirtualFileSystem {
  const fs = new VirtualFileSystem({ capacityBytes, trashPath: '/trash' });
  fs.createDirectory('/home/user/docs', { recursive: true });
  return fs;
}

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof SystemError ? e.code : 'OTHER';
  }
  return undefined;
};

describe('VirtualFileSystem', () => {
  it('creates a file with correct metadata', () => {
    const fs = makeFs();
    const stats = fs.createFile('/home/user/docs/a.txt', 'hello');
    expect(stats).toMatchObject({ name: 'a.txt', type: 'file', size: 5, path: '/home/user/docs/a.txt' });
    expect(stats.createdAt).toBeGreaterThan(0);
    expect(stats.modifiedAt).toBe(stats.createdAt);
    expect(fs.exists('/home/user/docs/a.txt')).toBe(true);
  });

  it('rejects duplicates, missing parents and invalid names', () => {
    const fs = makeFs();
    fs.createFile('/a.txt');
    expect(code(() => fs.createFile('/a.txt'))).toBe('EEXIST');
    expect(code(() => fs.createFile('/nope/a.txt'))).toBe('ENOENT');
    expect(code(() => fs.createFile('/a.txt/b'))).toBe('ENOTDIR');
    expect(code(() => fs.createFile('/bad\0name'))).toBe('EINVAL');
  });

  it('reads and writes files, updating size and modifiedAt', async () => {
    let now = 1000;
    const fs = new VirtualFileSystem({ now: () => now });
    fs.createFile('/a.txt', 'abc');
    now = 2000;
    fs.writeFile('/a.txt', 'hello world');
    expect(fs.readFile('/a.txt')).toBe('hello world');
    expect(fs.getStats('/a.txt')).toMatchObject({ size: 11, modifiedAt: 2000, createdAt: 1000 });
    fs.writeFile('/a.txt', '!', { append: true });
    expect(fs.readFile('/a.txt')).toBe('hello world!');
    expect(code(() => fs.readFile('/missing'))).toBe('ENOENT');
    expect(code(() => fs.readFile('/'))).toBe('EISDIR');
  });

  it('writeFile creates missing files unless create is false', () => {
    const fs = makeFs();
    fs.writeFile('/new.txt', 'x');
    expect(fs.readFile('/new.txt')).toBe('x');
    expect(code(() => fs.writeFile('/other.txt', 'x', { create: false }))).toBe('ENOENT');
  });

  it('counts bytes, not characters', () => {
    const fs = makeFs();
    fs.createFile('/u.txt', 'привет');
    expect(fs.getSize('/u.txt')).toBe(12);
  });

  it('creates directories (also recursively) and lists them sorted', () => {
    const fs = makeFs();
    fs.createDirectory('/x/y/z', { recursive: true });
    expect(fs.isDirectory('/x/y/z')).toBe(true);
    expect(code(() => fs.createDirectory('/p/q'))).toBe('ENOENT');
    fs.createFile('/b.txt');
    fs.createFile('/a.txt');
    expect(fs.listDirectory('/').map((e) => e.name)).toEqual(['a.txt', 'b.txt', 'home', 'x']);
    expect(code(() => fs.listDirectory('/a.txt'))).toBe('ENOTDIR');
  });

  it('deletes files and directories', () => {
    const fs = makeFs();
    fs.createFile('/home/user/docs/a.txt', 'abc');
    expect(code(() => fs.delete('/home/user/docs'))).toBe('ENOTEMPTY');
    fs.delete('/home/user/docs', { recursive: true });
    expect(fs.exists('/home/user/docs')).toBe(false);
    expect(fs.exists('/home/user/docs/a.txt')).toBe(false);
    expect(fs.getUsedBytes()).toBe(0);
    expect(code(() => fs.delete('/nothing'))).toBe('ENOENT');
  });

  it('renames nodes and protects against collisions', () => {
    const fs = makeFs();
    fs.createFile('/a.txt', 'x');
    fs.createFile('/b.txt', 'y');
    fs.rename('/a.txt', 'c.txt');
    expect(fs.exists('/a.txt')).toBe(false);
    expect(fs.readFile('/c.txt')).toBe('x');
    expect(code(() => fs.rename('/c.txt', 'b.txt'))).toBe('EEXIST');
    expect(code(() => fs.rename('/c.txt', 'a/b'))).toBe('EINVAL');
  });

  it('moves files into directories and by full path', () => {
    const fs = makeFs();
    fs.createFile('/a.txt', 'x');
    fs.move('/a.txt', '/home/user/docs');
    expect(fs.exists('/home/user/docs/a.txt')).toBe(true);
    fs.move('/home/user/docs/a.txt', '/renamed.txt');
    expect(fs.readFile('/renamed.txt')).toBe('x');
    expect(fs.exists('/home/user/docs/a.txt')).toBe(false);
  });

  it('refuses to move a directory into itself', () => {
    const fs = makeFs();
    fs.createDirectory('/home/user/docs/inner');
    expect(code(() => fs.move('/home', '/home/user/docs/inner'))).toBe('EINVAL');
    expect(code(() => fs.move('/home', '/home'))).toBe('EINVAL');
  });

  it('copies files and whole directory trees with independent content', () => {
    const fs = makeFs();
    fs.createFile('/home/user/docs/a.txt', 'abc');
    fs.copy('/home/user/docs', '/backup');
    expect(fs.readFile('/backup/a.txt')).toBe('abc');
    fs.writeFile('/backup/a.txt', 'changed');
    expect(fs.readFile('/home/user/docs/a.txt')).toBe('abc');
    expect(fs.getUsedBytes()).toBe(3 + 7);
    expect(code(() => fs.copy('/backup', '/backup/inner'))).toBe('EINVAL');
    expect(code(() => fs.copy('/backup', '/home/user/docs'))).toBe(undefined);
    expect(fs.exists('/home/user/docs/backup/a.txt')).toBe(true);
  });

  it('calculates recursive size', () => {
    const fs = makeFs();
    fs.createFile('/home/user/docs/a.txt', '12345');
    fs.createFile('/home/user/b.txt', '123');
    expect(fs.getSize('/home/user/docs')).toBe(5);
    expect(fs.getSize('/home')).toBe(8);
    expect(fs.getStats('/home').size).toBe(8);
    fs.createFile('/sparse.bin', '', { size: 1000 });
    expect(fs.getSize('/')).toBe(1008);
  });

  it('reports existence and stats', () => {
    const fs = makeFs();
    expect(fs.exists('/')).toBe(true);
    expect(fs.exists('/nope')).toBe(false);
    expect(fs.getStats('/home/user').childCount).toBe(1);
    expect(code(() => fs.getStats('/nope'))).toBe('ENOENT');
  });

  it('fails with "Disk is full" when out of space', () => {
    const fs = makeFs(10);
    fs.createFile('/a.txt', '12345678');
    expect(code(() => fs.createFile('/b.txt', '123'))).toBe('ENOSPC');
    expect(code(() => fs.writeFile('/a.txt', '12345678901'))).toBe('ENOSPC');
    fs.writeFile('/a.txt', '1234567890');
    // Disk exactly full: even an empty file cannot be created.
    expect(code(() => fs.createFile('/empty.txt'))).toBe('ENOSPC');
    fs.delete('/a.txt');
    expect(() => fs.createFile('/empty.txt')).not.toThrow();
  });

  it('protects readonly and protected nodes', () => {
    const fs = makeFs();
    fs.createDirectory('/sys');
    fs.createFile('/sys/kernel', 'k');
    fs.setAttributes('/sys/kernel', { readonly: true });
    fs.setAttributes('/sys', { readonly: true });
    expect(code(() => fs.writeFile('/sys/kernel', 'x'))).toBe('EACCES');
    expect(code(() => fs.delete('/sys/kernel'))).toBe('EACCES');
    expect(code(() => fs.createFile('/sys/new'))).toBe('EACCES');
    expect(code(() => fs.delete('/'))).toBe('EACCES');
    expect(code(() => fs.rename('/sys', 'other'))).toBe('EACCES');
  });

  it('moves items to the trash, restores them and empties it', () => {
    const fs = makeFs();
    fs.createFile('/home/user/docs/a.txt', 'abc');
    fs.trash('/home/user/docs/a.txt');
    expect(fs.exists('/home/user/docs/a.txt')).toBe(false);
    expect(fs.listTrash().map((t) => t.name)).toEqual(['a.txt']);
    expect(fs.listTrash()[0]!.trash?.originalPath).toBe('/home/user/docs/a.txt');
    expect(fs.getUsedBytes()).toBe(3);

    fs.restore('/trash/a.txt');
    expect(fs.readFile('/home/user/docs/a.txt')).toBe('abc');
    expect(fs.listTrash()).toHaveLength(0);

    fs.trash('/home/user/docs/a.txt');
    fs.createFile('/home/user/docs/a.txt', 'new');
    fs.trash('/home/user/docs/a.txt');
    expect(fs.listTrash().map((t) => t.name)).toEqual(['a (2).txt', 'a.txt']);
    expect(fs.emptyTrash()).toBe(2);
    expect(fs.listTrash()).toHaveLength(0);
    expect(fs.getUsedBytes()).toBe(0);
  });

  it('serialises and restores from a snapshot', () => {
    const fs = makeFs();
    fs.createFile('/home/user/docs/a.txt', 'abc');
    const copy = new VirtualFileSystem({ snapshot: JSON.parse(JSON.stringify(fs.serialize())) });
    expect(copy.readFile('/home/user/docs/a.txt')).toBe('abc');
    expect(copy.getUsedBytes()).toBe(3);
    expect(copy.countFiles()).toBe(1);
  });

  it('notifies subscribers about changes', () => {
    const fs = makeFs();
    let calls = 0;
    const off = fs.subscribe(() => calls++);
    fs.createFile('/a.txt');
    fs.delete('/a.txt');
    expect(calls).toBe(2);
    off();
    fs.createFile('/b.txt');
    expect(calls).toBe(2);
  });
});
