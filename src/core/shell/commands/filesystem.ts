import { SystemError, errorMessage } from '../../errors';
import type { FileStats } from '../../filesystem/types';
import { globToRegExp } from '../../../utils/glob';
import { basename, join } from '../../../utils/path';
import { formatBytes, formatDateTime } from '../../../utils/format';
import { fail, ok, type Command } from '../types';
import { flagError, forEachTarget, lines, parseSize, splitFlags, usage } from './helpers';

const isHidden = (name: string) => name.startsWith('.');

function modeOf(s: FileStats): string {
  return `${s.type === 'directory' ? 'd' : '-'}r${s.readonly ? '-' : 'w'}${s.type === 'directory' ? 'x' : '-'}`;
}

const pwd: Command = {
  name: 'pwd',
  description: 'Print the current directory',
  execute: (_args, ctx) => ok(ctx.cwd + '\n'),
};

const cd: Command = {
  name: 'cd',
  description: 'Change the current directory',
  usage: 'cd [directory]',
  execute(args, ctx) {
    const arg = args[0];
    let target: string;
    if (arg === undefined) target = ctx.env.HOME ?? '/';
    else if (arg === '-') target = ctx.env.OLDPWD ?? ctx.cwd;
    else target = ctx.resolve(arg);
    try {
      if (!ctx.fs.exists(target)) throw new SystemError('ENOENT', target);
      if (!ctx.fs.isDirectory(target)) throw new SystemError('ENOTDIR', target);
      ctx.setCwd(target);
      return ok(arg === '-' ? target + '\n' : '');
    } catch (e) {
      return fail(`cd: ${errorMessage(e)}\n`);
    }
  },
};

const ls: Command = {
  name: 'ls',
  description: 'List directory contents',
  usage: 'ls [-l] [-a] [path...]',
  execute(args, ctx) {
    const parsed = splitFlags(args, 'la');
    const bad = flagError('ls', parsed);
    if (bad) return bad;
    const long = parsed.flags.has('l');
    const all = parsed.flags.has('a');
    const targets = parsed.rest.length ? parsed.rest : ['.'];
    const format = (s: FileStats) =>
      long ? `${modeOf(s)}  ${(s.type === 'directory' ? '-' : formatBytes(s.size)).padStart(9)}  ${formatDateTime(s.modifiedAt)}  ${s.name}` : s.name;

    let stdout = '';
    let stderr = '';
    targets.forEach((target, index) => {
      const path = ctx.resolve(target);
      try {
        const stats = ctx.fs.getStats(path);
        if (targets.length > 1) stdout += (index > 0 ? '\n' : '') + `${target}:\n`;
        if (stats.type === 'file') stdout += format(stats) + '\n';
        else {
          const entries = ctx.fs.listDirectory(path).filter((e) => all || !isHidden(e.name));
          stdout += lines(entries.map(format));
        }
      } catch (e) {
        stderr += `ls: ${target}: ${e instanceof SystemError ? e.message : errorMessage(e)}\n`;
      }
    });
    return { stdout, stderr, exitCode: stderr ? 1 : 0 };
  },
};

const mkdir: Command = {
  name: 'mkdir',
  description: 'Create directories',
  usage: 'mkdir [-p] directory...',
  execute(args, ctx) {
    const parsed = splitFlags(args, 'p');
    const bad = flagError('mkdir', parsed);
    if (bad) return bad;
    if (!parsed.rest.length) return usage('mkdir', '[-p] directory...');
    return forEachTarget('mkdir', parsed.rest, (p) => {
      ctx.fs.createDirectory(ctx.resolve(p), { recursive: parsed.flags.has('p') });
    });
  },
};

const touch: Command = {
  name: 'touch',
  description: 'Create empty files or update their timestamp',
  usage: 'touch file...',
  execute(args, ctx) {
    if (!args.length) return usage('touch', 'file...');
    return forEachTarget('touch', args, (p) => {
      const path = ctx.resolve(p);
      if (ctx.fs.exists(path)) {
        if (ctx.fs.isFile(path)) ctx.fs.writeFile(path, ctx.fs.readFile(path));
      } else ctx.fs.createFile(path, '');
    });
  },
};

const cat: Command = {
  name: 'cat',
  description: 'Print file contents',
  usage: 'cat [file...]',
  execute(args, ctx) {
    if (!args.length) return ctx.hasStdin ? ok(ctx.stdin) : usage('cat', 'file...');
    let stdout = '';
    const result = forEachTarget('cat', args, (p) => {
      const text = ctx.fs.readFile(ctx.resolve(p));
      stdout += text.endsWith('\n') || text === '' ? text : text + '\n';
    });
    return { ...result, stdout };
  },
};

const echo: Command = {
  name: 'echo',
  description: 'Print text (supports > and >> redirection)',
  usage: 'echo [-n] text...',
  execute(args) {
    const noNewline = args[0] === '-n';
    const text = (noNewline ? args.slice(1) : args).join(' ');
    return ok(noNewline ? text : text + '\n');
  },
};

const rm: Command = {
  name: 'rm',
  description: 'Move files to the trash (-P deletes permanently)',
  usage: 'rm [-r] [-f] [-P] path...',
  execute(args, ctx) {
    const parsed = splitFlags(args, 'rfP');
    const bad = flagError('rm', parsed);
    if (bad) return bad;
    if (!parsed.rest.length) return usage('rm', '[-r] [-f] [-P] path...');
    const force = parsed.flags.has('f');
    const recursive = parsed.flags.has('r');
    const result = forEachTarget('rm', parsed.rest, (p) => {
      const path = ctx.resolve(p);
      if (!ctx.fs.exists(path)) {
        if (force) return;
        throw new SystemError('ENOENT', path);
      }
      if (ctx.fs.isDirectory(path) && !recursive) throw new SystemError('EISDIR', path);
      if (parsed.flags.has('P') || ctx.fs.isInTrash(path)) ctx.fs.delete(path, { recursive });
      else ctx.fs.trash(path);
    });
    return force ? { ...result, exitCode: 0 } : result;
  },
};

const rmdir: Command = {
  name: 'rmdir',
  description: 'Remove empty directories',
  usage: 'rmdir directory...',
  execute(args, ctx) {
    if (!args.length) return usage('rmdir', 'directory...');
    return forEachTarget('rmdir', args, (p) => {
      const path = ctx.resolve(p);
      if (!ctx.fs.isDirectory(path)) throw new SystemError(ctx.fs.exists(path) ? 'ENOTDIR' : 'ENOENT', path);
      ctx.fs.delete(path);
    });
  },
};

/** Shared implementation of mv and cp: source(s) followed by a destination. */
function transfer(
  name: 'mv' | 'cp',
  args: readonly string[],
  ctx: Parameters<Command['execute']>[1],
  recursive: boolean,
) {
  if (args.length < 2) return usage(name, name === 'cp' ? '[-r] source... destination' : 'source... destination');
  const sources = args.slice(0, -1);
  const destArg = args[args.length - 1]!;
  const dest = ctx.resolve(destArg);
  const destIsDir = ctx.fs.isDirectory(dest);
  if (sources.length > 1 && !destIsDir) return fail(`${name}: ${destArg}: ${new SystemError('ENOTDIR').message}\n`);
  return forEachTarget(name, sources, (s) => {
    const src = ctx.resolve(s);
    const stats = ctx.fs.getStats(src);
    if (name === 'cp' && stats.type === 'directory' && !recursive) {
      throw new SystemError('EISDIR', src, 'Is a directory (use -r to copy directories)');
    }
    const target = destIsDir ? join(dest, basename(src)) : dest;
    // Like POSIX cp/mv, a file replaces an existing file.
    if (stats.type === 'file' && ctx.fs.isFile(target) && target !== src) {
      if (name === 'cp') {
        ctx.fs.writeFile(target, ctx.fs.readFile(src));
        return;
      }
      ctx.fs.delete(target);
    }
    if (name === 'cp') ctx.fs.copy(src, destIsDir ? dest : target);
    else ctx.fs.move(src, destIsDir ? dest : target);
  });
}

const mv: Command = {
  name: 'mv',
  description: 'Move or rename files',
  usage: 'mv source... destination',
  execute: (args, ctx) => transfer('mv', args, ctx, true),
};

const cp: Command = {
  name: 'cp',
  description: 'Copy files and directories',
  usage: 'cp [-r] source... destination',
  execute(args, ctx) {
    const parsed = splitFlags(args, 'r');
    const bad = flagError('cp', parsed);
    if (bad) return bad;
    return transfer('cp', parsed.rest, ctx, parsed.flags.has('r'));
  },
};

const rename: Command = {
  name: 'rename',
  description: 'Rename a file or directory',
  usage: 'rename path new-name',
  execute(args, ctx) {
    if (args.length !== 2) return usage('rename', 'path new-name');
    return forEachTarget('rename', [args[0]!], (p) => {
      ctx.fs.rename(ctx.resolve(p), args[1]!);
    });
  },
};

const tree: Command = {
  name: 'tree',
  description: 'Show a directory tree',
  usage: 'tree [-a] [path]',
  execute(args, ctx) {
    const parsed = splitFlags(args, 'a');
    const bad = flagError('tree', parsed);
    if (bad) return bad;
    const arg = parsed.rest[0] ?? '.';
    const root = ctx.resolve(arg);
    try {
      if (!ctx.fs.isDirectory(root)) throw new SystemError(ctx.fs.exists(root) ? 'ENOTDIR' : 'ENOENT', root);
      let dirs = 0;
      let files = 0;
      const out = [arg];
      const visit = (dir: string, prefix: string) => {
        const entries = ctx.fs.listDirectory(dir).filter((e) => parsed.flags.has('a') || !isHidden(e.name));
        entries.forEach((entry, i) => {
          const last = i === entries.length - 1;
          out.push(`${prefix}${last ? '└── ' : '├── '}${entry.name}`);
          if (entry.type === 'directory') {
            dirs++;
            visit(entry.path, prefix + (last ? '    ' : '│   '));
          } else files++;
        });
      };
      visit(root, '');
      out.push('', `${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`);
      return ok(lines(out));
    } catch (e) {
      return fail(`tree: ${errorMessage(e)}\n`);
    }
  },
};

const find: Command = {
  name: 'find',
  description: 'Search for files by name or type',
  usage: 'find [path] [-name pattern] [-type f|d]',
  execute(args, ctx) {
    let start = '.';
    let namePattern: RegExp | null = null;
    let type: 'f' | 'd' | null = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-name' || a === '-iname') {
        const p = args[++i];
        if (p === undefined) return usage('find', '[path] [-name pattern] [-type f|d]');
        namePattern = globToRegExp(p, a === '-iname' ? 'i' : '');
      } else if (a === '-type') {
        const t = args[++i];
        if (t !== 'f' && t !== 'd') return usage('find', '[path] [-name pattern] [-type f|d]');
        type = t;
      } else if (i === 0 && !a.startsWith('-')) start = a;
      else return fail(`find: invalid argument: ${a}\n`, 2);
    }
    const root = ctx.resolve(start);
    try {
      const rootStats = ctx.fs.getStats(root);
      const display = (path: string) => (root === '/' ? path : start.replace(/\/+$/, '') + path.slice(root.length));
      const matches = (s: FileStats) =>
        (!namePattern || namePattern.test(s.name)) &&
        (!type || (type === 'd' ? s.type === 'directory' : s.type === 'file'));
      const all = [rootStats, ...(rootStats.type === 'directory' ? ctx.fs.walk(root) : [])];
      return ok(lines(all.filter(matches).map((s) => (s.path === root ? start : display(s.path)))));
    } catch (e) {
      return fail(`find: ${errorMessage(e)}\n`);
    }
  },
};

const stat: Command = {
  name: 'stat',
  description: 'Show detailed file information',
  usage: 'stat path...',
  execute(args, ctx) {
    if (!args.length) return usage('stat', 'path...');
    let out = '';
    const result = forEachTarget('stat', args, (p) => {
      const s = ctx.fs.getStats(ctx.resolve(p));
      out += lines([
        `  Name: ${s.name}`,
        `  Path: ${s.path}`,
        `  Type: ${s.type}`,
        `  Size: ${s.size} bytes (${formatBytes(s.size)})`,
        `  Created:  ${formatDateTime(s.createdAt)}`,
        `  Modified: ${formatDateTime(s.modifiedAt)}`,
        `  Flags: ${[s.readonly && 'readonly', s.protected && 'protected'].filter(Boolean).join(', ') || 'none'}`,
      ]);
    });
    return { ...result, stdout: out };
  },
};

const du: Command = {
  name: 'du',
  description: 'Show disk usage of files and directories',
  usage: 'du [path...]',
  execute(args, ctx) {
    let out = '';
    const result = forEachTarget('du', args.length ? args : ['.'], (p) => {
      const path = ctx.resolve(p);
      out += `${formatBytes(ctx.fs.getSize(path)).padEnd(10)} ${p}\n`;
    });
    return { ...result, stdout: out };
  },
};

const fallocate: Command = {
  name: 'fallocate',
  description: 'Create a file of a given size (e.g. 10M, 2G) to test disk limits',
  usage: 'fallocate file size',
  execute(args, ctx) {
    if (args.length !== 2) return usage('fallocate', 'file size');
    const size = parseSize(args[1]!);
    if (size === null) return fail(`fallocate: invalid size: ${args[1]}\n`, 2);
    return forEachTarget('fallocate', [args[0]!], (p) => {
      ctx.fs.createFile(ctx.resolve(p), '', { size });
    });
  },
};

const trash: Command = {
  name: 'trash',
  description: 'Manage the trash: list, restore, empty',
  usage: 'trash [ls | restore name | empty]',
  execute(args, ctx) {
    const [sub = 'ls', name] = args;
    try {
      if (sub === 'ls') {
        const items = ctx.fs.listTrash();
        return ok(items.length ? lines(items.map((i) => `${i.name}  (from ${i.trash?.originalPath ?? '?'})`)) : 'Trash is empty\n');
      }
      if (sub === 'empty') {
        const n = ctx.fs.emptyTrash();
        return ok(`Deleted ${n} item${n === 1 ? '' : 's'} permanently\n`);
      }
      if (sub === 'restore' && name) {
        const restored = ctx.fs.restore(join(ctx.fs.trashPath, name));
        return ok(`Restored to ${restored.path}\n`);
      }
      return usage('trash', '[ls | restore name | empty]');
    } catch (e) {
      return fail(`trash: ${errorMessage(e)}\n`);
    }
  },
};

const open: Command = {
  name: 'open',
  description: 'Open a file or folder in a desktop application',
  usage: 'open path',
  execute(args, ctx) {
    if (args.length !== 1) return usage('open', 'path');
    return forEachTarget('open', args, (p) => {
      const path = ctx.resolve(p);
      ctx.computer.openPath(path);
      return `Opening ${path}\n`;
    });
  },
};

export const filesystemCommands: Command[] = [
  pwd, cd, ls, mkdir, touch, cat, echo, rm, rmdir, mv, cp, rename, tree, find, stat, du, fallocate, trash, open,
];
