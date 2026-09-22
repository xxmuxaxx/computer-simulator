import { CommandRegistry, type Command } from '../types';
import { filesystemCommands } from './filesystem';
import { internetCommands } from './internet';
import { networkCommands } from './network';
import { systemCommands } from './system';
import { textCommands } from './text';

export const builtinCommands: Command[] = [...systemCommands, ...filesystemCommands, ...textCommands, ...networkCommands, ...internetCommands];

export function createDefaultRegistry(): CommandRegistry {
  return new CommandRegistry().registerAll(builtinCommands);
}
