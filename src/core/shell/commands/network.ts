import { errorMessage } from '../../errors';
import { calculateNetwork, maskToPrefixLength } from '../../network/ip';
import type { NetworkDevice } from '../../network/types';
import { fail, ok, type Command, type CommandContext } from '../types';
import { lines, usage } from './helpers';

function localDevice(ctx: CommandContext): NetworkDevice {
  const network = ctx.computer.network;
  return network.getDevice(network.localDeviceId)!;
}

function routeTable(device: NetworkDevice): string {
  const header = 'DESTINATION'.padEnd(18) + 'GATEWAY'.padEnd(16) + 'INTERFACE';
  const rows: string[] = [];
  for (const i of device.interfaces) {
    if (i.ipAddress && i.subnetMask) {
      const network = calculateNetwork(i.ipAddress, i.subnetMask);
      rows.push(`${network}/${maskToPrefixLength(i.subnetMask)}`.padEnd(18) + 'connected'.padEnd(16) + i.name);
    }
  }
  for (const i of device.interfaces) {
    if (i.gateway) rows.push('0.0.0.0/0'.padEnd(18) + i.gateway.padEnd(16) + i.name);
  }
  return lines([header, ...rows]);
}

const ip: Command = {
  name: 'ip',
  description: 'Show network interfaces, addresses and routes',
  usage: 'ip [addr|route|link]',
  execute(args, ctx) {
    const sub = args[0] ?? 'addr';
    const device = localDevice(ctx);
    if (sub === 'addr' || sub === 'a' || sub === 'address') {
      const out: string[] = [];
      for (const i of device.interfaces) {
        out.push(i.name, `  state ${i.status.toUpperCase()}`, `  mac ${i.macAddress}`);
        out.push(i.ipAddress && i.subnetMask ? `  inet ${i.ipAddress}/${maskToPrefixLength(i.subnetMask)}` : '  inet -');
        if (i.gateway) out.push(`  gateway ${i.gateway}`);
        out.push('');
      }
      return ok(lines(out));
    }
    if (sub === 'route' || sub === 'r') return ok(routeTable(device));
    if (sub === 'link' || sub === 'l') {
      const header = 'IFACE'.padEnd(10) + 'STATE'.padEnd(8) + 'MAC';
      return ok(lines([header, ...device.interfaces.map((i) => i.name.padEnd(10) + i.status.toUpperCase().padEnd(8) + i.macAddress)]));
    }
    return usage('ip', '[addr|route|link]');
  },
};

const ifconfig: Command = {
  name: 'ifconfig',
  description: 'Show network interface configuration',
  execute(_a, ctx) {
    const device = localDevice(ctx);
    const blocks = device.interfaces.map((i) =>
      lines([
        `${i.name}: flags=UP,BROADCAST  state ${i.status.toUpperCase()}`,
        i.ipAddress ? `        inet ${i.ipAddress}  netmask ${i.subnetMask ?? '-'}` : '        inet -',
        `        ether ${i.macAddress}`,
      ]),
    );
    return ok(blocks.join('\n'));
  },
};

const ping: Command = {
  name: 'ping',
  description: 'Send ICMP echo requests to a network host',
  usage: 'ping [-c count] <host>',
  execute(args, ctx) {
    let count = 4;
    const rest: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-c') count = Math.max(1, Number(args[++i]) || 4);
      else rest.push(args[i]!);
    }
    const target = rest[0];
    if (!target) return usage('ping', '[-c count] <host>');
    const network = ctx.computer.network;
    let resolvedIp: string;
    let results: ReturnType<typeof network.ping>['results'];
    try {
      ({ resolvedIp, results } = network.ping(network.localDeviceId, target, count));
    } catch {
      return fail(`ping: unknown host ${target}\n`, 1);
    }
    const out = [`PING ${target} (${resolvedIp})`, ''];
    let received = 0;
    results.forEach((r, i) => {
      if (r.delivered) {
        received++;
        out.push(`64 bytes from ${resolvedIp}: icmp_seq=${i + 1} ttl=64 time=${r.latencyMs}ms`);
      } else {
        out.push('Request timeout');
      }
    });
    const loss = Math.round(((count - received) / count) * 100);
    out.push('', `--- ${target} ping statistics ---`, `${count} packets transmitted, ${received} received, ${loss}% packet loss`);
    return ok(lines(out));
  },
};

const traceroute: Command = {
  name: 'traceroute',
  description: 'Show the route packets take to a network host',
  usage: 'traceroute <host>',
  execute(args, ctx) {
    const target = args[0];
    if (!target) return usage('traceroute', '<host>');
    const network = ctx.computer.network;
    let result: ReturnType<typeof network.traceroute>;
    try {
      result = network.traceroute(network.localDeviceId, target);
    } catch {
      return fail(`traceroute: unknown host ${target}\n`, 1);
    }
    const out = [`traceroute to ${target} (${result.resolvedIp}), 30 hops max`];
    for (const hop of result.hops) out.push(` ${hop.index}  ${hop.hostname} (${hop.ip ?? '?'})  ${hop.latencyMs}ms`);
    if (!result.ok) out.push(`  * ${result.errorCode === 'ETTLEXPIRED' ? 'TTL expired in transit' : 'Destination unreachable'}`);
    return ok(lines(out));
  },
};

const arp: Command = {
  name: 'arp',
  description: 'Show the ARP cache (known IP-to-MAC mappings)',
  execute(_a, ctx) {
    const network = ctx.computer.network;
    const entries = network.getArpEntries(network.localDeviceId);
    const header = 'ADDRESS'.padEnd(18) + 'HWADDRESS'.padEnd(20) + 'IFACE';
    return ok(lines([header, ...entries.map((e) => e.ip.padEnd(18) + e.mac.padEnd(20) + e.iface)]));
  },
};

const route: Command = {
  name: 'route',
  description: 'Show the kernel IP routing table',
  execute(_a, ctx) {
    return ok(`Kernel IP routing table\n${routeTable(localDevice(ctx))}`);
  },
};

const nslookup: Command = {
  name: 'nslookup',
  description: 'Query the DNS for a hostname',
  usage: 'nslookup <hostname>',
  execute(args, ctx) {
    const hostname = args[0];
    if (!hostname) return usage('nslookup', '<hostname>');
    const network = ctx.computer.network;
    try {
      const address = network.resolveDns(network.localDeviceId, hostname);
      return ok(lines(['Name:', `  ${hostname}`, '', 'Address:', `  ${address}`]));
    } catch {
      return fail(`nslookup: can't find ${hostname}: NXDOMAIN\n`, 1);
    }
  },
};

const netstat: Command = {
  name: 'netstat',
  description: 'Show network service ports and their status',
  execute(_a, ctx) {
    const network = ctx.computer.network;
    const services = network.listServices(network.localDeviceId);
    const header = 'PORT'.padEnd(8) + 'PROTOCOL'.padEnd(12) + 'SERVICE'.padEnd(14) + 'STATUS';
    const rows = services.map(
      (s) => String(s.port).padEnd(8) + s.protocol.padEnd(12) + s.name.padEnd(14) + (s.status === 'running' ? 'LISTEN' : 'CLOSED'),
    );
    return ok(lines([header, ...rows]));
  },
};

const server: Command = {
  name: 'server',
  description: 'Start, stop or list network services on this computer',
  usage: 'server list | start|stop|restart <service>',
  execute(args, ctx) {
    const network = ctx.computer.network;
    const local = network.localDeviceId;
    const [action, name] = args;
    if (!action || action === 'list') {
      const services = network.listServices(local);
      return ok(lines(services.map((s) => `${s.name.padEnd(8)} :${s.port}`.padEnd(20) + (s.status === 'running' ? 'RUNNING' : 'STOPPED'))));
    }
    if (!name) return usage('server', 'list | start|stop|restart <service>');
    try {
      if (action === 'start') {
        const svc = network.startService(local, name);
        return ok(`${svc.name} server started\nListening on 0.0.0.0:${svc.port}\n`);
      }
      if (action === 'stop') {
        const existing = network.listServices(local).find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (!existing) return fail(`server: no such service: ${name}\n`);
        network.stopService(local, existing.id);
        return ok(`${existing.name} server stopped\n`);
      }
      if (action === 'restart') {
        const existing = network.listServices(local).find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (existing) network.stopService(local, existing.id);
        const svc = network.startService(local, name);
        return ok(`${svc.name} server restarted\n`);
      }
    } catch (e) {
      return fail(`server: ${errorMessage(e)}\n`);
    }
    return usage('server', 'list | start|stop|restart <service>');
  },
};

export const networkCommands: Command[] = [ip, ifconfig, ping, traceroute, arp, route, nslookup, netstat, server];
