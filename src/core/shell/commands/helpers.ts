import { SystemError, errorMessage } from '../../errors';
import { fail, ok, type CommandResult } from '../types';

const LONG_FLAGS: Record<string, string> = {
  recursive: 'r',
  force: 'f',
  all: 'a',
  long: 'l',
  parents: 'p',
  permanent: 'P',
  'ignore-case': 'i',
  'line-number': 'n',
  'invert-match': 'v',
  human: 'h',
};

export interface ParsedFlags {
  flags: Set<string>;
  rest: string[];
  error?: string;
}

/** Splits `-rf --verbose file` into a flag set and positional arguments. */
export function splitFlags(args: readonly string[], allowed: string): ParsedFlags {
  const flags = new Set<string>();
  const rest: string[] = [];
  let endOfFlags = false;
  for (const arg of args) {
    if (endOfFlags || arg === '-' || !arg.startsWith('-')) {
      rest.push(arg);
    } else if (arg === '--') {
      endOfFlags = true;
    } else if (arg.startsWith('--')) {
      const mapped = LONG_FLAGS[arg.slice(2)];
      if (!mapped || !allowed.includes(mapped)) return { flags, rest, error: `invalid option: ${arg}` };
      flags.add(mapped);
    } else {
      for (const ch of arg.slice(1)) {
        if (!allowed.includes(ch)) return { flags, rest, error: `invalid option: -${ch}` };
        flags.add(ch);
      }
    }
  }
  return { flags, rest };
}

/** Runs `fn` for every item, collecting output and errors like a real coreutils command. */
export function forEachTarget<T>(
  name: string,
  items: readonly T[],
  fn: (item: T) => string | void,
  label: (item: T) => string = String,
): CommandResult {
  let stdout = '';
  let stderr = '';
  for (const item of items) {
    try {
      const out = fn(item);
      if (out) stdout += out;
    } catch (e) {
      stderr += `${name}: ${label(item)}: ${e instanceof SystemError ? e.message : errorMessage(e)}\n`;
    }
  }
  return { stdout, stderr, exitCode: stderr ? 1 : 0 };
}

export const lines = (items: readonly string[]): string => (items.length ? items.join('\n') + '\n' : '');

export function usage(name: string, text: string): CommandResult {
  return fail(`usage: ${name} ${text}`, 2);
}

export function flagError(name: string, parsed: ParsedFlags): CommandResult | null {
  return parsed.error ? fail(`${name}: ${parsed.error}`, 2) : null;
}

export { ok, fail };

const SIZE_UNITS: Record<string, number> = { '': 1, b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/** Parses "10", "4K", "1.5G" into bytes. Returns null when invalid. */
export function parseSize(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([bkmgt]?)b?$/i.exec(text.trim());
  if (!m) return null;
  return Math.round(Number(m[1]) * SIZE_UNITS[m[2]!.toLowerCase()]!);
}
