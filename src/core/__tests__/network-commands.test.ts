import { describe, expect, it } from 'vitest';
import { createShell } from './helpers';

describe('network terminal commands', () => {
  it('ip addr shows the local address', () => {
    const { shell } = createShell();
    const result = shell.run('ip addr');
    expect(result.stdout).toContain('192.168.0.100/24');
    expect(result.stdout).toMatch(/mac ([0-9A-F]{2}:){5}[0-9A-F]{2}/);
  });

  it('ip route shows the connected network and default route', () => {
    const { shell } = createShell();
    const result = shell.run('ip route');
    expect(result.stdout).toContain('192.168.0.0/24');
    expect(result.stdout).toContain('connected');
    expect(result.stdout).toContain('0.0.0.0/0');
    expect(result.stdout).toContain('192.168.0.1');
  });

  it('pings the server by hostname (acceptance scenario step 3)', () => {
    const { shell } = createShell();
    const result = shell.run('ping server.local');
    expect(result.stdout).toContain('PING server.local (192.168.0.101)');
    expect(result.stdout).toContain('bytes from 192.168.0.101');
    expect(result.stdout).toContain('0% packet loss');
    expect(result.exitCode).toBe(0);
  });

  it('reports an unknown host for ping', () => {
    const { shell } = createShell();
    const result = shell.run('ping does-not-exist.local');
    expect(result.stderr).toContain('unknown host');
    expect(result.exitCode).toBe(1);
  });

  it('resolves a hostname via nslookup (acceptance scenario step 4)', () => {
    const { shell } = createShell();
    const result = shell.run('nslookup server.local');
    expect(result.stdout).toContain('server.local');
    expect(result.stdout).toContain('192.168.0.101');
  });

  it('netstat reflects services started on the local machine', () => {
    const { shell } = createShell();
    expect(shell.run('netstat').stdout.trim()).toBe('PORT    PROTOCOL    SERVICE       STATUS');
    shell.run('server start http');
    const result = shell.run('netstat');
    expect(result.stdout).toMatch(/80\s+TCP\s+HTTP\s+LISTEN/);
  });

  it('server list shows the local machine\'s own services', () => {
    const { shell } = createShell();
    shell.run('server start http');
    const result = shell.run('server list');
    expect(result.stdout).toMatch(/HTTP.*RUNNING/);
  });

  it('starts and stops a service on the local machine', () => {
    const { shell } = createShell();
    let result = shell.run('server start ssh');
    expect(result.stdout).toContain('SSH server started');
    result = shell.run('netstat');
    expect(result.stdout).toMatch(/22\s+TCP\s+SSH\s+LISTEN/);
    result = shell.run('server stop ssh');
    expect(result.stdout).toContain('SSH server stopped');
  });

  it('shows the ARP cache for the local segment', () => {
    const { shell } = createShell();
    const result = shell.run('arp');
    expect(result.stdout).toContain('192.168.0.1');
    expect(result.stdout).toContain('192.168.0.101');
  });

  it('traces the route to the server', () => {
    const { shell } = createShell();
    const result = shell.run('traceroute server.local');
    expect(result.stdout).toContain('traceroute to server.local');
  });
});
