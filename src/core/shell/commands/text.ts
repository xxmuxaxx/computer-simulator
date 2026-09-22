import { SystemError, errorMessage } from '../../errors';
import { fail, ok, type Command, type CommandContext } from '../types';
import { flagError, lines, splitFlags, usage } from './helpers';

/** Reads the text of each file argument, or stdin when there are none. */
function inputs(args: readonly string[], ctx: CommandContext): { name: string; text: string }[] {
  if (!args.length) return [{ name: '(stdin)', text: ctx.stdin }];
  return args.map((a) => ({ name: a, text: ctx.fs.readFile(ctx.resolve(a)) }));
}

const splitLines = (text: string): string[] => {
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
};

function parseCount(args: readonly string[]): { count: number; files: string[] } | null {
  let count = 10;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-n') {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 0) return null;
      count = n;
    } else if (/^-\d+$/.test(a)) count = Number(a.slice(1));
    else files.push(a);
  }
  return { count, files };
}

const head: Command = {
  name: 'head',
  description: 'Print the first lines of a file or input',
  usage: 'head [-n count] [file...]',
  execute(args, ctx) {
    const parsed = parseCount(args);
    if (!parsed) return usage('head', '[-n count] [file...]');
    try {
      const out = inputs(parsed.files, ctx).map((i) => splitLines(i.text).slice(0, parsed.count).join('\n'));
      return ok(lines(out.filter((o) => o !== '')));
    } catch (e) {
      return fail(`head: ${errorMessage(e)}\n`);
    }
  },
};

const tail: Command = {
  name: 'tail',
  description: 'Print the last lines of a file or input',
  usage: 'tail [-n count] [file...]',
  execute(args, ctx) {
    const parsed = parseCount(args);
    if (!parsed) return usage('tail', '[-n count] [file...]');
    try {
      const out = inputs(parsed.files, ctx).map((i) => {
        const all = splitLines(i.text);
        return all.slice(Math.max(0, all.length - parsed.count)).join('\n');
      });
      return ok(lines(out.filter((o) => o !== '')));
    } catch (e) {
      return fail(`tail: ${errorMessage(e)}\n`);
    }
  },
};

const wc: Command = {
  name: 'wc',
  description: 'Count lines, words and bytes',
  usage: 'wc [-l] [-w] [-c] [file...]',
  execute(args, ctx) {
    const parsed = splitFlags(args, 'lwc');
    const bad = flagError('wc', parsed);
    if (bad) return bad;
    const all = parsed.flags.size === 0;
    try {
      const rows = inputs(parsed.rest, ctx).map((i) => {
        const cols: number[] = [];
        if (all || parsed.flags.has('l')) cols.push(splitLines(i.text).length);
        if (all || parsed.flags.has('w')) cols.push(i.text.split(/\s+/).filter(Boolean).length);
        if (all || parsed.flags.has('c')) cols.push(new TextEncoder().encode(i.text).length);
        return cols.map((c) => String(c).padStart(6)).join('') + (parsed.rest.length ? ` ${i.name}` : '');
      });
      return ok(lines(rows));
    } catch (e) {
      return fail(`wc: ${errorMessage(e)}\n`);
    }
  },
};

const grep: Command = {
  name: 'grep',
  description: 'Search for a pattern in files or input',
  usage: 'grep [-i] [-n] [-v] [-r] pattern [file...]',
  execute(args, ctx) {
    const parsed = splitFlags(args, 'invr');
    const bad = flagError('grep', parsed);
    if (bad) return bad;
    const [pattern, ...files] = parsed.rest;
    if (pattern === undefined) return usage('grep', '[-i] [-n] [-v] [-r] pattern [file...]');
    let re: RegExp;
    try {
      re = new RegExp(pattern, parsed.flags.has('i') ? 'i' : '');
    } catch {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), parsed.flags.has('i') ? 'i' : '');
    }
    const invert = parsed.flags.has('v');
    const numbered = parsed.flags.has('n');

    const sources: { name: string; text: string }[] = [];
    let stderr = '';
    if (!files.length) sources.push({ name: '(stdin)', text: ctx.stdin });
    for (const f of files) {
      const path = ctx.resolve(f);
      try {
        if (ctx.fs.isDirectory(path)) {
          if (!parsed.flags.has('r')) throw new SystemError('EISDIR', f);
          for (const s of ctx.fs.walk(path)) {
            if (s.type === 'file') sources.push({ name: s.path, text: ctx.fs.readFile(s.path) });
          }
        } else sources.push({ name: f, text: ctx.fs.readFile(path) });
      } catch (e) {
        stderr += `grep: ${f}: ${e instanceof SystemError ? e.message : errorMessage(e)}\n`;
      }
    }
    const prefixNames = files.length > 1 || parsed.flags.has('r');
    const out: string[] = [];
    for (const src of sources) {
      splitLines(src.text).forEach((line, i) => {
        if (re.test(line) !== invert) {
          out.push(`${prefixNames ? src.name + ':' : ''}${numbered ? i + 1 + ':' : ''}${line}`);
        }
      });
    }
    return { stdout: lines(out), stderr, exitCode: out.length ? (stderr ? 2 : 0) : 1 };
  },
};

export const textCommands: Command[] = [head, tail, wc, grep];
