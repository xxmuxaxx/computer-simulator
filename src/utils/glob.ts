/** Converts a shell glob (`*`, `?`) into a RegExp matching a whole name. */
export function globToRegExp(pattern: string, flags = ''): RegExp {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, flags);
}

export function hasGlob(text: string): boolean {
  return /[*?]/.test(text);
}
