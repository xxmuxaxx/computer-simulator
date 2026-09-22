import type { VirtualComputer } from '../computer/VirtualComputer';
import type { VirtualFileSystem } from '../filesystem/VirtualFileSystem';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Ask the terminal to wipe its screen. */
  clear?: boolean;
}

export interface CommandContext {
  computer: VirtualComputer;
  fs: VirtualFileSystem;
  cwd: string;
  env: Readonly<Record<string, string>>;
  /** Output of the previous command in a pipeline (empty when not piped). */
  stdin: string;
  hasStdin: boolean;
  history: readonly string[];
  registry: CommandRegistry;
  userName: string;
  hostName: string;
  /** Resolves a user-supplied path against the current directory. */
  resolve(path: string): string;
  setCwd(path: string): void;
  clearHistory(): void;
  setEnv(name: string, value: string): void;
}

/** A shell command. New commands are added by registering them, the Terminal never changes. */
export interface Command {
  name: string;
  description: string;
  usage?: string;
  aliases?: string[];
  execute(args: string[], context: CommandContext): CommandResult;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): this {
    this.commands.set(command.name, command);
    for (const alias of command.aliases ?? []) this.commands.set(alias, command);
    return this;
  }

  registerAll(commands: readonly Command[]): this {
    for (const c of commands) this.register(c);
    return this;
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /** Unique commands (aliases excluded), sorted by name. */
  list(): Command[] {
    return [...new Set(this.commands.values())].sort((a, b) => a.name.localeCompare(b.name));
  }

  names(): string[] {
    return [...this.commands.keys()].sort();
  }
}

export const ok = (stdout = ''): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
export const fail = (stderr: string, exitCode = 1): CommandResult => ({ stdout: '', stderr, exitCode });
