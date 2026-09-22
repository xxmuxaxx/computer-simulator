/** POSIX-like path helpers. Independent of Node's `path` so it works in the browser. */

export const SEP = '/';

export function normalize(path: string): string {
  if (path === '') return '.';
  const absolute = path.startsWith(SEP);
  const out: string[] = [];
  for (const part of path.split(SEP)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else out.push(part);
  }
  const joined = out.join(SEP);
  if (absolute) return SEP + joined;
  return joined === '' ? '.' : joined;
}

export function resolve(cwd: string, path: string): string {
  return path.startsWith(SEP) ? normalize(path) : normalize(cwd + SEP + path);
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p !== '').join(SEP));
}

export function basename(path: string): string {
  const n = normalize(path);
  if (n === SEP) return SEP;
  return n.slice(n.lastIndexOf(SEP) + 1);
}

export function dirname(path: string): string {
  const n = normalize(path);
  if (n === SEP) return SEP;
  const i = n.lastIndexOf(SEP);
  if (i < 0) return '.';
  return i === 0 ? SEP : n.slice(0, i);
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
}

export function splitPath(path: string): string[] {
  return normalize(path).split(SEP).filter(Boolean);
}

export function isInside(parent: string, child: string): boolean {
  const p = normalize(parent);
  const c = normalize(child);
  if (p === SEP) return true;
  return c === p || c.startsWith(p + SEP);
}

/** Replaces the home prefix with "~" (for shell prompts). */
export function tildify(path: string, home: string): string {
  if (path === home) return '~';
  if (path.startsWith(home + SEP)) return '~' + path.slice(home.length);
  return path;
}
