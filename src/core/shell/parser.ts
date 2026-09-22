import { SystemError } from '../errors';

/**
 * Command line parser. Turns a line into a list of pipelines:
 *
 *   mkdir a && cd a; echo "hi there" > f.txt | cat
 *
 * Words keep track of how they were quoted so the shell can decide later what to expand.
 */

export type Quote = 'none' | 'single' | 'double';

export interface WordPart {
  text: string;
  quote: Quote;
}

export interface Word {
  parts: WordPart[];
}

export type OperatorToken = '|' | '>' | '>>' | ';' | '&&';

export type Token = { type: 'word'; word: Word } | { type: 'op'; op: OperatorToken };

export interface Stage {
  words: Word[];
  redirect?: { append: boolean; target: Word };
}

export interface ParsedItem {
  pipeline: Stage[];
  /** How this item is connected to the previous one. */
  connector: ';' | '&&';
}

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let parts: WordPart[] = [];
  let current = '';
  let quote = 'none' as Quote;
  let hasWord = false;

  const flushPart = () => {
    if (current !== '' || (quote !== 'none' && hasWord)) parts.push({ text: current, quote });
    current = '';
  };
  const flushWord = () => {
    flushPart();
    if (hasWord) tokens.push({ type: 'word', word: { parts } });
    parts = [];
    hasWord = false;
  };
  const changeQuote = (next: Quote) => {
    flushPart();
    quote = next;
    hasWord = true;
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === 'single') {
      if (ch === "'") changeQuote('none');
      else current += ch;
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') changeQuote('none');
      else if (ch === '\\' && i + 1 < line.length && '"\\$'.includes(line[i + 1]!)) current += line[++i];
      else current += ch;
      continue;
    }
    if (ch === "'") changeQuote('single');
    else if (ch === '"') changeQuote('double');
    else if (ch === '\\') {
      if (i + 1 < line.length) {
        // An escaped character is always literal: emit it as a single-quoted part.
        flushPart();
        parts.push({ text: line[++i]!, quote: 'single' });
        hasWord = true;
      }
    } else if (/\s/.test(ch)) flushWord();
    else if (ch === '|' || ch === ';' || ch === '>' || (ch === '&' && line[i + 1] === '&')) {
      flushWord();
      if (ch === '>' && line[i + 1] === '>') {
        tokens.push({ type: 'op', op: '>>' });
        i++;
      } else if (ch === '&') {
        tokens.push({ type: 'op', op: '&&' });
        i++;
      } else tokens.push({ type: 'op', op: ch });
    } else if (ch === '#' && !hasWord) break;
    else {
      current += ch;
      hasWord = true;
    }
  }
  if (quote !== 'none') throw new SystemError('ESYNTAX', undefined, `Syntax error: unterminated ${quote} quote`);
  flushWord();
  return tokens;
}

export function parse(line: string): ParsedItem[] {
  const tokens = tokenize(line);
  const items: ParsedItem[] = [];
  let stage: Stage = { words: [] };
  let pipeline: Stage[] = [];
  let connector: ';' | '&&' = ';';
  let pendingRedirect: boolean | null = null; // append flag while waiting for the target

  const endStage = () => {
    if (pendingRedirect !== null) throw new SystemError('ESYNTAX', undefined, 'Syntax error: missing redirect target');
    pipeline.push(stage);
    stage = { words: [] };
  };
  const endPipeline = (next: ';' | '&&') => {
    endStage();
    const empty = pipeline.length === 1 && pipeline[0]!.words.length === 0 && !pipeline[0]!.redirect;
    if (!empty) {
      if (pipeline.some((s) => s.words.length === 0)) {
        throw new SystemError('ESYNTAX', undefined, 'Syntax error: empty command in pipeline');
      }
      items.push({ pipeline, connector });
    } else if (connector === '&&' || next === '&&') {
      throw new SystemError('ESYNTAX', undefined, 'Syntax error: expected a command next to &&');
    }
    pipeline = [];
    connector = next;
  };

  for (const token of tokens) {
    if (token.type === 'word') {
      if (pendingRedirect !== null) {
        stage.redirect = { append: pendingRedirect, target: token.word };
        pendingRedirect = null;
      } else stage.words.push(token.word);
      continue;
    }
    switch (token.op) {
      case '>':
      case '>>':
        if (pendingRedirect !== null) throw new SystemError('ESYNTAX', undefined, 'Syntax error near ">"');
        pendingRedirect = token.op === '>>';
        break;
      case '|':
        endStage();
        break;
      case ';':
      case '&&':
        endPipeline(token.op);
        break;
    }
  }
  endPipeline(';');
  return items;
}

export interface ExpandContext {
  env: Readonly<Record<string, string>>;
  lastExitCode: number;
}

export interface ExpandedWord {
  text: string;
  /** True when an unquoted `*` or `?` is present. */
  glob: boolean;
}

/** Expands `~` and `$VARS`, and reports whether the word is a glob pattern. */
export function expandWord(word: Word, ctx: ExpandContext): ExpandedWord {
  let text = '';
  let glob = false;
  word.parts.forEach((part, index) => {
    let piece = part.text;
    if (part.quote === 'none' && index === 0 && (piece === '~' || piece.startsWith('~/'))) {
      piece = (ctx.env.HOME ?? '/') + piece.slice(1);
    }
    if (part.quote !== 'single') {
      piece = piece.replace(/\$(\?|\w+|\{\w+\})/g, (_m, name: string) => {
        if (name === '?') return String(ctx.lastExitCode);
        const key = name.startsWith('{') ? name.slice(1, -1) : name;
        return ctx.env[key] ?? '';
      });
    }
    if (part.quote === 'none' && /[*?]/.test(piece)) glob = true;
    text += piece;
  });
  return { text, glob };
}
