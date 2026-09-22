import { errorMessage } from '../../errors';
import { parseUrl } from '../../internet/http/url';
import type { Domain, DnsRecordType } from '../../internet/types';
import type { HttpMethod } from '../../network/types';
import { fail, ok, type Command, type CommandContext } from '../types';
import { lines, usage } from './helpers';

const DNS_RECORD_TYPES: readonly DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];

function fmtDate(ts: number | undefined): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : '-';
}

function requireDomain(ctx: CommandContext, name: string): Domain {
  return ctx.computer.internet.domains.whois(name);
}

const domain: Command = {
  name: 'domain',
  description: 'Manage virtual domain registrations',
  usage: 'domain check|register|renew|release|list|whois <name>',
  execute(args, ctx) {
    const [action, name] = args;
    const registry = ctx.computer.internet.domains;
    if (!action || action === 'list') {
      const domains = registry.list();
      if (!domains.length) return ok('No domains registered.\n');
      const header = 'DOMAIN'.padEnd(28) + 'STATUS'.padEnd(12) + 'EXPIRES';
      return ok(lines([header, ...domains.map((d) => d.name.padEnd(28) + d.status.toUpperCase().padEnd(12) + fmtDate(d.expiresAt))]));
    }
    if (!name) return usage('domain', 'check|register|renew|release|list|whois <name>');
    try {
      if (action === 'check') {
        const availability = registry.check(name);
        return ok(`${name}\nStatus: ${availability}\n`);
      }
      if (action === 'register') {
        registry.register(name, ctx.userName);
        return ok('Domain registered successfully.\n');
      }
      if (action === 'renew') {
        const renewed = registry.renew(name);
        return ok(`${renewed.name} renewed until ${fmtDate(renewed.expiresAt)}\n`);
      }
      if (action === 'release') {
        registry.release(name);
        return ok(`${name} released\n`);
      }
      if (action === 'whois') {
        return ok(whoisText(requireDomain(ctx, name)));
      }
    } catch (e) {
      return fail(`domain: ${errorMessage(e)}\n`, 1);
    }
    return usage('domain', 'check|register|renew|release|list|whois <name>');
  },
};

function whoisText(d: Domain): string {
  return lines([
    `Domain: ${d.name}`,
    `Status: ${d.status.toUpperCase()}`,
    `Owner: ${d.ownerId ?? '-'}`,
    `Created: ${fmtDate(d.createdAt)}`,
    `Expires: ${fmtDate(d.expiresAt)}`,
    ...d.nameservers.map((ns) => `Nameserver: ${ns.hostname}`),
  ]);
}

const whois: Command = {
  name: 'whois',
  description: 'Look up registration details for a domain',
  usage: 'whois <domain>',
  execute(args, ctx) {
    const name = args[0];
    if (!name) return usage('whois', '<domain>');
    try {
      return ok(whoisText(requireDomain(ctx, name)));
    } catch {
      return fail(`whois: no match for ${name}\n`, 1);
    }
  },
};

const dns: Command = {
  name: 'dns',
  description: 'Query and manage DNS records for a virtual domain',
  usage: 'dns lookup <host> | add <domain> <type> <name> <value> | list <domain>',
  execute(args, ctx) {
    const [action] = args;
    const zone = ctx.computer.internet.dns;
    if (action === 'lookup') {
      const host = args[1];
      if (!host) return usage('dns', 'lookup <host>');
      const ip = zone.resolve(host) ?? tryNetworkResolve(ctx, host);
      if (!ip) return fail(`dns: could not resolve ${host}\n`, 1);
      return ok(lines(['Name:', `  ${host}`, '', 'Address:', `  ${ip}`]));
    }
    if (action === 'list') {
      const name = args[1];
      if (!name) return usage('dns', 'list <domain>');
      try {
        const d = requireDomain(ctx, name);
        const records = zone.list(d.id);
        if (!records.length) return ok(`No DNS records for ${d.name}.\n`);
        const header = 'NAME'.padEnd(24) + 'TYPE'.padEnd(8) + 'VALUE';
        return ok(
          lines([header, ...records.map((r) => `${r.name === '@' ? d.name : `${r.name}.${d.name}`}`.padEnd(24) + r.type.padEnd(8) + r.value)]),
        );
      } catch (e) {
        return fail(`dns: ${errorMessage(e)}\n`, 1);
      }
    }
    if (action === 'add') {
      const [, name, type, recordName, value] = args;
      if (!name || !type || !recordName || !value) return usage('dns', 'add <domain> <type> <name> <value>');
      const upperType = type.toUpperCase();
      if (!DNS_RECORD_TYPES.includes(upperType as DnsRecordType)) return fail(`dns: unknown record type ${type}\n`, 1);
      try {
        const d = requireDomain(ctx, name);
        zone.addRecord(d.id, upperType as DnsRecordType, recordName, value);
        return ok(`${recordName === '@' ? d.name : `${recordName}.${d.name}`}  ${upperType}  ${value}\n`);
      } catch (e) {
        return fail(`dns: ${errorMessage(e)}\n`, 1);
      }
    }
    return usage('dns', 'lookup <host> | add <domain> <type> <name> <value> | list <domain>');
  },
};

function tryNetworkResolve(ctx: CommandContext, host: string): string | undefined {
  try {
    return ctx.computer.network.resolveDns(ctx.computer.network.localDeviceId, host);
  } catch {
    return undefined;
  }
}

const website: Command = {
  name: 'website',
  description: 'Create, list and manage websites hosted on the virtual network',
  usage: 'website list | create <domain> [server] | delete|enable|disable <domain>',
  execute(args, ctx) {
    const [action, name] = args;
    const hosting = ctx.computer.internet.hosting;
    const network = ctx.computer.network;
    if (!action || action === 'list') {
      const sites = hosting.list();
      if (!sites.length) return ok('No websites.\n');
      const header = 'DOMAIN'.padEnd(28) + 'SERVER'.padEnd(16) + 'STATUS';
      const rows = sites.map((w) => {
        const d = ctx.computer.internet.domains.get(w.domainId);
        const server = network.getDevice(w.serverId);
        return (d?.name ?? '?').padEnd(28) + (server?.hostname ?? '?').padEnd(16) + (w.enabled ? 'ONLINE' : 'OFFLINE');
      });
      return ok(lines([header, ...rows]));
    }
    if (!name) return usage('website', 'list | create <domain> [server] | delete|enable|disable <domain>');
    try {
      const domainRecord = requireDomain(ctx, name);
      const existing = hosting.list().find((w) => w.domainId === domainRecord.id);
      if (action === 'create') {
        const serverArg = args[2];
        const server = serverArg ? network.findDeviceByHostname(serverArg) : network.findDeviceByHostname('server.local');
        if (!server) return fail(`website: no such server${serverArg ? `: ${serverArg}` : ''}\n`, 1);
        hosting.createWebsite({ domainId: domainRecord.id, serverId: server.id });
        return ok(`${domainRecord.name} is now hosted on ${server.hostname}\n`);
      }
      if (!existing) return fail(`website: ${domainRecord.name} has no website\n`, 1);
      if (action === 'delete') {
        hosting.deleteWebsite(existing.id);
        return ok(`${domainRecord.name} deleted\n`);
      }
      if (action === 'enable' || action === 'disable') {
        hosting.setEnabled(existing.id, action === 'enable');
        return ok(`${domainRecord.name} ${action}d\n`);
      }
    } catch (e) {
      return fail(`website: ${errorMessage(e)}\n`, 1);
    }
    return usage('website', 'list | create <domain> [server] | delete|enable|disable <domain>');
  },
};

const curl: Command = {
  name: 'curl',
  description: 'Transfer data from a virtual web server',
  usage: 'curl [-X method] [-d data] <url>',
  execute(args, ctx) {
    let method: HttpMethod = 'GET';
    let body: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-X') method = (args[++i] ?? 'GET').toUpperCase() as HttpMethod;
      else if (args[i] === '-d' || args[i] === '--data') {
        body = args[++i];
        if (method === 'GET') method = 'POST';
      } else rest.push(args[i]!);
    }
    const target = rest[0];
    if (!target) return usage('curl', '[-X method] [-d data] <url>');
    const { host, port, path } = parseUrl(target);
    try {
      const response = ctx.computer.network.httpRequest(ctx.computer.network.localDeviceId, host, { port, path, method, body });
      const headers = response.headers ?? { 'Content-Type': response.contentType };
      const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
      return ok(lines([`HTTP/1.1 ${response.status} ${response.statusText}`, ...headerLines, '', response.body]));
    } catch (e) {
      return fail(`curl: ${errorMessage(e)}\n`, 1);
    }
  },
};

const wget: Command = {
  name: 'wget',
  description: 'Download a file from a virtual web server',
  usage: 'wget <url>',
  execute(args, ctx) {
    const target = args[0];
    if (!target) return usage('wget', '<url>');
    const { host, port, path } = parseUrl(target);
    try {
      const response = ctx.computer.network.httpRequest(ctx.computer.network.localDeviceId, host, { port, path });
      if (response.status !== 200) return fail(`wget: server returned ${response.status} ${response.statusText}\n`, 1);
      const filename = path.split('/').filter(Boolean).pop() || 'index.html';
      const dest = `/home/user/Downloads/${filename}`;
      ctx.computer.fileSystem.writeFile(dest, response.body);
      return ok(`Saved to: ${dest}\n`);
    } catch (e) {
      return fail(`wget: ${errorMessage(e)}\n`, 1);
    }
  },
};

const cert: Command = {
  name: 'cert',
  description: 'Issue and inspect virtual HTTPS certificates',
  usage: 'cert issue <domain> | list | status <domain>',
  execute(args, ctx) {
    const [action, name] = args;
    const ca = ctx.computer.internet.certificates;
    if (action === 'list') {
      const certs = ca.list();
      if (!certs.length) return ok('No certificates issued.\n');
      const header = 'DOMAIN'.padEnd(28) + 'ISSUER'.padEnd(14) + 'STATUS'.padEnd(10) + 'EXPIRES';
      return ok(
        lines([header, ...certs.map((c) => c.domain.padEnd(28) + c.issuer.padEnd(14) + ca.getStatus(c.domain).padEnd(10) + fmtDate(c.validTo))]),
      );
    }
    if (!name) return usage('cert', 'issue <domain> | list | status <domain>');
    if (action === 'issue') {
      const certificate = ca.issue(name);
      return ok(`Certificate issued for ${certificate.domain} (valid until ${fmtDate(certificate.validTo)})\n`);
    }
    if (action === 'status') {
      return ok(`${name}: ${ca.getStatus(name).toUpperCase()}\n`);
    }
    return usage('cert', 'issue <domain> | list | status <domain>');
  },
};

export const internetCommands: Command[] = [domain, whois, dns, website, cert, curl, wget];
