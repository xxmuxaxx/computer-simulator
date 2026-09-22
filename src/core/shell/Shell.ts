import { errorMessage } from '../errors';
import type { VirtualComputer } from '../computer/VirtualComputer';
import { HOME } from '../filesystem/seed';
import { globToRegExp } from '../../utils/glob';
import { resolve as resolvePath, tildify } from '../../utils/path';
import { createDefaultRegistry } from './commands';
import { expandWord, parse, type Stage } from './parser';
import { CommandRegistry, fail, type CommandContext, type CommandResult } from './types';

export interface ShellOptions {
  registry?: CommandRegistry;
  cwd?: string;
}

export interface Completion {
  /** Index in the input where the replaced word starts. */
  start: number;
  candidates: string[];
}

const withNewline = (text: string): string => (text === '' || text.endsWith('\n') ? text : text + '\n');

/**
 * A shell session: current directory, environment, history and the command runner.
 * Purely logical, the Terminal application is only a view on top of it.
 */
export class Shell {
  readonly registry: CommandRegistry;
  private computer: VirtualComputer;
  private _cwd: string;
  private env: Record<string, string>;
  private _history: string[] = [];
  private lastExitCode = 0;

  constructor(computer: VirtualComputer, options: ShellOptions = {}) {
    this.computer = computer;
    this.registry = options.registry ?? createDefaultRegistry();
    this._cwd = options.cwd ?? HOME;
    this.env = { HOME, PWD: this._cwd, OLDPWD: this._cwd, SHELL: '/system/sh' };
  }

  get cwd(): string {
    return this._cwd;
  }

  get history(): readonly string[] {
    return this._history;
  }

  get prompt(): string {
    const settings = this.computer.settings.getSnapshot();
    return `${settings.userName}@${settings.computerName}:${tildify(this._cwd, HOME)}$ `;
  }

  /** Parses and executes a command line. Never throws. */
  run(line: string): CommandResult {
    if (line.trim() === '') return { stdout: '', stderr: '', exitCode: 0 };
    this._history.push(line);
    let items;
    try {
      items = parse(line);
    } catch (e) {
      this.lastExitCode = 2;
      return fail(`Error: ${errorMessage(e)}\n`, 2);
    }
    let stdout = '';
    let stderr = '';
    let clear = false;
    for (const item of items) {
      if (item.connector === '&&' && this.lastExitCode !== 0) continue;
      const result = this.runPipeline(item.pipeline);
      if (result.clear) {
        clear = true;
        stdout = '';
        stderr = '';
      }
      stdout += result.stdout;
      stderr += result.stderr;
      this.lastExitCode = result.exitCode;
    }
    return { stdout, stderr, exitCode: this.lastExitCode, clear };
  }

  /** Suggests completions for the last word of `input` (commands first, paths afterwards). */
  complete(input: string): Completion {
    const match = /(?:^|\s)(\S*)$/.exec(input);
    const word = match?.[1] ?? '';
    const start = input.length - word.length;
    const before = input.slice(0, start);
    const isCommandPosition = before.trim() === '' || /(\||;|&&)\s*$/.test(before);
    const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
    const escape = (s: string) => s.replace(/([\s'"\\$&|;<>*?])/g, '\\$1');
    const raw = unescape(word);

    if (isCommandPosition && !raw.includes('/')) {
      return { start, candidates: this.registry.names().filter((n) => n.startsWith(raw)) };
    }
    const slash = raw.lastIndexOf('/');
    const dirPart = slash >= 0 ? raw.slice(0, slash + 1) : '';
    const base = raw.slice(slash + 1);
    const dirPath = this.resolve(dirPart === '' ? '.' : dirPart.replace(/^~/, this.env.HOME ?? '/'));
    try {
      const candidates = this.computer.fileSystem
        .listDirectory(dirPath)
        .filter((e) => e.name.startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.')))
        .map((e) => escape(dirPart + e.name) + (e.type === 'directory' ? '/' : ''));
      return { start, candidates };
    } catch {
      return { start, candidates: [] };
    }
  }

  private fullEnv(): Record<string, string> {
    const settings = this.computer.settings.getSnapshot();
    return { ...this.env, USER: settings.userName, HOSTNAME: settings.computerName };
  }

  private resolve(path: string): string {
    return resolvePath(this._cwd, path);
  }

  private setCwd(path: string): void {
    this.env.OLDPWD = this._cwd;
    this._cwd = path;
    this.env.PWD = path;
  }

  private expandArgs(stage: Stage): string[] {
    const argv: string[] = [];
    for (const word of stage.words) {
      const { text, glob } = expandWord(word, { env: this.fullEnv(), lastExitCode: this.lastExitCode });
      argv.push(...(glob ? this.expandGlob(text) : [text]));
    }
    return argv;
  }

  private expandGlob(pattern: string): string[] {
    const slash = pattern.lastIndexOf('/');
    const dirPart = slash >= 0 ? pattern.slice(0, slash + 1) : '';
    const basePattern = pattern.slice(slash + 1);
    try {
      const re = globToRegExp(basePattern);
      const names = this.computer.fileSystem
        .listDirectory(this.resolve(dirPart === '' ? '.' : dirPart))
        .map((e) => e.name)
        .filter((n) => re.test(n) && (basePattern.startsWith('.') || !n.startsWith('.')));
      return names.length ? names.map((n) => dirPart + n) : [pattern];
    } catch {
      return [pattern];
    }
  }

  private runPipeline(stages: Stage[]): CommandResult {
    let stdin = '';
    let hasStdin = false;
    let stderr = '';
    let last: CommandResult = { stdout: '', stderr: '', exitCode: 0 };
    for (const stage of stages) {
      const argv = this.expandArgs(stage);
      const name = argv[0] ?? '';
      const command = this.registry.get(name);
      let result: CommandResult;
      if (!command) {
        result = fail(`Error: Invalid command: ${name} (type "help" to list commands)\n`, 127);
      } else {
        try {
          result = command.execute(argv.slice(1), this.createContext(stdin, hasStdin));
        } catch (e) {
          result = fail(`${name}: ${errorMessage(e)}\n`);
        }
      }
      stderr += withNewline(result.stderr);
      let stdout = result.stdout;
      if (stage.redirect) {
        try {
          const target = expandWord(stage.redirect.target, { env: this.fullEnv(), lastExitCode: this.lastExitCode }).text;
          this.computer.fileSystem.writeFile(this.resolve(target), stdout, { append: stage.redirect.append });
          stdout = '';
        } catch (e) {
          stderr += `${name}: ${errorMessage(e)}\n`;
          result = { ...result, exitCode: result.exitCode || 1 };
          stdout = '';
        }
      }
      stdin = stdout;
      hasStdin = true;
      last = { ...result, stdout, stderr: '' };
    }
    return { ...last, stderr };
  }

  private createContext(stdin: string, hasStdin: boolean): CommandContext {
    const settings = this.computer.settings.getSnapshot();
    return {
      computer: this.computer,
      fs: this.computer.fileSystem,
      cwd: this._cwd,
      env: this.fullEnv(),
      stdin,
      hasStdin,
      history: this._history,
      registry: this.registry,
      userName: settings.userName,
      hostName: settings.computerName,
      resolve: (p) => this.resolve(p),
      setCwd: (p) => this.setCwd(p),
      clearHistory: () => {
        this._history = [];
      },
      setEnv: (name, value) => {
        this.env[name] = value;
      },
    };
  }
}
