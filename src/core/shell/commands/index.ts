import { CommandRegistry, type Command } from '../types';
import { filesystemCommands } from './filesystem';
import { systemCommands } from './system';
import { textCommands } from './text';

export const builtinCommands: Command[] = [...systemCommands, ...filesystemCommands, ...textCommands];

export function createDefaultRegistry(): CommandRegistry {
  return new CommandRegistry().registerAll(builtinCommands);
}
