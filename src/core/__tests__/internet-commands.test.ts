import { describe, expect, it } from 'vitest';
import { createShell } from './helpers';

describe('internet terminal commands', () => {
  it('checks, registers and lists a domain', () => {
    const { shell } = createShell();
    expect(shell.run('domain check example.com').stdout).toContain('AVAILABLE');
    expect(shell.run('domain register example.com').stdout).toContain('registered successfully');
    expect(shell.run('domain check example.com').stdout).toContain('TAKEN');
    expect(shell.run('domain list').stdout).toContain('example.com');
  });

  it('adds a DNS A record and looks it up', () => {
    const { shell } = createShell();
    shell.run('domain register example.com');
    const add = shell.run('dns add example.com A @ 192.168.0.150');
    expect(add.exitCode).toBe(0);
    const lookup = shell.run('dns lookup example.com');
    expect(lookup.stdout).toContain('192.168.0.150');
  });

  it('whois reports registration details', () => {
    const { shell } = createShell();
    shell.run('domain register example.com');
    const result = shell.run('whois example.com');
    expect(result.stdout).toContain('Domain: example.com');
    expect(result.stdout).toContain('Status: ACTIVE');
    expect(result.stdout).toContain('ns1.virtual-dns');
  });

  it('creates a website, curls it, and wgets its index page (acceptance-style flow)', () => {
    const { shell } = createShell();
    shell.run('domain register mysite.local');
    shell.run('dns add mysite.local A @ 192.168.0.101');
    const create = shell.run('website create mysite.local server.local');
    expect(create.stdout).toContain('mysite.local is now hosted on server.local');

    const curl = shell.run('curl http://mysite.local');
    expect(curl.stdout).toContain('HTTP/1.1 200 OK');
    expect(curl.stdout).toContain('mysite.local');

    const wget = shell.run('wget http://mysite.local');
    expect(wget.stdout).toContain('Saved to: /home/user/Downloads/index.html');

    const list = shell.run('website list');
    expect(list.stdout).toContain('mysite.local');
    expect(list.stdout).toContain('ONLINE');

    shell.run('website disable mysite.local');
    expect(shell.run('curl http://mysite.local').stdout).toContain('503');
  });
});
