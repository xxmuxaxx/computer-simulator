import { errorMessage } from '../../errors';
import { DOOM_APP_ID, installDoom } from '../../runtime/doom/DoomRuntimeAdapter';
import type { RuntimeManifest } from '../../runtime/types';
import { fail, ok, type Command, type CommandContext } from '../types';
import { lines, usage } from './helpers';

/** Adapters installable via `games install <id>` - a small static map for v1 (just DOOM). */
const INSTALLABLE: Record<string, (ctx: CommandContext) => void> = {
  [DOOM_APP_ID]: (ctx) => installDoom(ctx.computer.runtime),
};

function manifestLine(m: RuntimeManifest): string {
  return m.id.padEnd(16) + m.name.padEnd(20) + m.version.padEnd(14) + m.type;
}

function runningPid(ctx: CommandContext, id: string): number | undefined {
  return ctx.computer.processManager.list().find((p) => p.appId === id)?.pid;
}

const games: Command = {
  name: 'games',
  description: 'Install, run and manage runtime applications and games',
  usage: '[list|install|run|stop|info|remove] <id>',
  execute(args, ctx) {
    const [action, id] = args;

    if (!action || action === 'list') {
      const manifests = ctx.computer.runtime.registry.list();
      if (!manifests.length) return ok('No games installed.\n');
      const header = 'ID'.padEnd(16) + 'NAME'.padEnd(20) + 'VERSION'.padEnd(14) + 'TYPE';
      return ok(lines([header, ...manifests.map(manifestLine)]));
    }

    if (!id) return usage('games', '[list|install|run|stop|info|remove] <id>');

    if (action === 'install') {
      const installer = INSTALLABLE[id];
      if (!installer) return fail(`games: no installable game named "${id}"\n`, 1);
      try {
        installer(ctx);
      } catch (e) {
        return fail(`games: install: ${errorMessage(e)}\n`, 1);
      }
      return ok(`${id} installed.\n`);
    }

    if (action === 'run') {
      try {
        const { pid } = ctx.computer.launch(id);
        return ok(`${id} started (PID ${pid}).\n`);
      } catch (e) {
        return fail(`games: run: ${errorMessage(e)}\n`, 1);
      }
    }

    if (action === 'stop') {
      const pid = runningPid(ctx, id);
      if (pid === undefined) return fail(`games: ${id} is not running\n`, 1);
      try {
        ctx.computer.killProcess(pid);
      } catch (e) {
        return fail(`games: stop: ${errorMessage(e)}\n`, 1);
      }
      return ok(`${id} stopped.\n`);
    }

    if (action === 'info') {
      const manifest = ctx.computer.runtime.registry.get(id);
      if (!manifest) return fail(`games: ${id} is not installed\n`, 1);
      const pid = runningPid(ctx, id);
      return ok(
        lines([
          `Name: ${manifest.name}`,
          `Version: ${manifest.version}`,
          `Type: ${manifest.type}`,
          `Memory: ${manifest.memoryUsage} MB`,
          `Display: ${manifest.display.width}x${manifest.display.height}`,
          `Permissions: ${manifest.permissions.join(', ') || '-'}`,
          `Status: ${pid !== undefined ? `running (PID ${pid})` : 'installed'}`,
        ]),
      );
    }

    if (action === 'remove') {
      try {
        ctx.computer.runtime.uninstall(id);
      } catch (e) {
        return fail(`games: remove: ${errorMessage(e)}\n`, 1);
      }
      return ok(`${id} removed.\n`);
    }

    return usage('games', '[list|install|run|stop|info|remove] <id>');
  },
};

export const gamesCommands: Command[] = [games];
