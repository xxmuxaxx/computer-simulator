import { errorMessage } from '../../errors';
import { bar, formatBytes, formatDate, formatMB, formatUptime } from '../../../utils/format';
import { fail, ok, type Command } from '../types';
import { forEachTarget, lines, usage } from './helpers';

const help: Command = {
  name: 'help',
  description: 'List commands or show help for one command',
  usage: 'help [command]',
  execute(args, ctx) {
    const name = args[0];
    if (name) {
      const cmd = ctx.registry.get(name);
      if (!cmd) return fail(`help: no such command: ${name}\n`);
      return ok(lines([`${cmd.name} - ${cmd.description}`, `usage: ${cmd.usage ?? cmd.name}`]));
    }
    const all = ctx.registry.list();
    const width = Math.max(...all.map((c) => c.name.length)) + 2;
    return ok(lines(['Available commands:', ...all.map((c) => `  ${c.name.padEnd(width)}${c.description}`), '', 'Use "help <command>" for details. Pipes (|), redirection (> >>), && and ; are supported.']));
  },
};

const clear: Command = {
  name: 'clear',
  description: 'Clear the terminal screen',
  execute: () => ({ stdout: '', stderr: '', exitCode: 0, clear: true }),
};

const whoami: Command = {
  name: 'whoami',
  description: 'Print the current user name',
  execute: (_a, ctx) => ok(ctx.userName + '\n'),
};

const hostname: Command = {
  name: 'hostname',
  description: 'Print the computer name',
  execute: (_a, ctx) => ok(ctx.hostName + '\n'),
};

const date: Command = {
  name: 'date',
  description: 'Print the current virtual date and time',
  execute: (_a, ctx) => ok(formatDate(ctx.computer.clock()) + '\n'),
};

const uname: Command = {
  name: 'uname',
  description: 'Print system information',
  usage: 'uname [-a]',
  execute(args, ctx) {
    if (args.includes('-a')) return ok(`CompSimOS ${ctx.hostName} 1.0.0 #1 SMP virtual x86_64-sim\n`);
    return ok('CompSimOS\n');
  },
};

const uptime: Command = {
  name: 'uptime',
  description: 'Show how long the computer has been running',
  execute: (_a, ctx) => ok(`up ${formatUptime(ctx.computer.uptimeMs())}, load ${ctx.computer.cpu.load.toFixed(1)}%\n`),
};

const ps: Command = {
  name: 'ps',
  description: 'List running processes',
  execute(_args, ctx) {
    const rows = ctx.computer.processManager.list().sort((a, b) => a.pid - b.pid);
    const header = 'PID'.padEnd(6) + 'NAME'.padEnd(22) + 'CPU'.padEnd(8) + 'MEMORY'.padEnd(10) + 'STATUS';
    return ok(
      lines([
        header,
        ...rows.map(
          (p) =>
            String(p.pid).padEnd(6) +
            p.name.padEnd(22) +
            `${p.cpuUsage.toFixed(1)}%`.padEnd(8) +
            formatMB(p.memoryUsage).padEnd(10) +
            p.status,
        ),
      ]),
    );
  },
};

const kill: Command = {
  name: 'kill',
  description: 'Terminate a process by PID',
  usage: 'kill pid...',
  execute(args, ctx) {
    const pids = args.filter((a) => !/^-\d+$/.test(a));
    if (!pids.length) return usage('kill', 'pid...');
    let stdout = '';
    const result = forEachTarget('kill', pids, (raw) => {
      const pid = Number(raw);
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid PID');
      const proc = ctx.computer.processManager.get(pid);
      ctx.computer.killProcess(pid);
      stdout += `Killed ${proc?.name ?? 'process'} (${pid})\n`;
    });
    return { ...result, stdout };
  },
};

const memory: Command = {
  name: 'memory',
  description: 'Show memory usage',
  aliases: ['free'],
  execute(_a, ctx) {
    const m = ctx.computer.memory;
    return ok(
      lines([
        'Memory',
        `  Total: ${m.totalMB} MB`,
        `  Used:  ${Math.round(m.usedMB)} MB (${m.usagePercent.toFixed(1)}%)`,
        `  Free:  ${Math.round(m.freeMB)} MB`,
        `  ${bar(m.usagePercent)} ${Math.round(m.usagePercent)}%`,
      ]),
    );
  },
};

const cpu: Command = {
  name: 'cpu',
  description: 'Show CPU information and load',
  execute(_a, ctx) {
    const c = ctx.computer.cpu;
    return ok(
      lines([
        `CPU: ${c.model}`,
        `  Cores:     ${c.cores}`,
        `  Frequency: ${c.frequencyMHz} MHz (base ${c.baseFrequencyMHz}, max ${c.maxFrequencyMHz})`,
        `  Load:      ${bar(c.load)} ${c.load.toFixed(1)}%`,
        ...c.coreLoads.map((l, i) => `  core${i}:     ${bar(l, 12)} ${l.toFixed(1)}%`),
      ]),
    );
  },
};

const df: Command = {
  name: 'df',
  description: 'Show virtual disk usage',
  execute(_a, ctx) {
    const d = ctx.computer.disk;
    return ok(
      lines([
        'Filesystem'.padEnd(14) + 'Size'.padEnd(11) + 'Used'.padEnd(11) + 'Avail'.padEnd(11) + 'Use%',
        'vdisk0'.padEnd(14) +
          formatBytes(d.totalBytes).padEnd(11) +
          formatBytes(d.usedBytes).padEnd(11) +
          formatBytes(d.freeBytes).padEnd(11) +
          `${Math.round(d.usagePercent)}%`,
      ]),
    );
  },
};

const history: Command = {
  name: 'history',
  description: 'Show command history (-c clears it)',
  usage: 'history [-c]',
  execute(args, ctx) {
    if (args[0] === '-c') {
      ctx.clearHistory();
      return ok();
    }
    return ok(lines(ctx.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`)));
  },
};

const env: Command = {
  name: 'env',
  description: 'Print environment variables',
  execute: (_a, ctx) => ok(lines(Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`))),
};

const exportCmd: Command = {
  name: 'export',
  description: 'Set an environment variable',
  usage: 'export NAME=value',
  execute(args, ctx) {
    if (!args.length) return usage('export', 'NAME=value');
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)=(.*)$/.exec(a);
      if (!m) return fail(`export: invalid assignment: ${a}\n`);
      try {
        ctx.setEnv(m[1]!, m[2]!);
      } catch (e) {
        return fail(`export: ${errorMessage(e)}\n`);
      }
    }
    return ok();
  },
};

export const systemCommands: Command[] = [
  help, clear, whoami, hostname, date, uname, uptime, ps, kill, memory, cpu, df, history, env, exportCmd,
];
