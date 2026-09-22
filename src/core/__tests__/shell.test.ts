import { describe, expect, it } from 'vitest';
import { parse, tokenize } from '../shell/parser';
import type { Command } from '../shell/types';
import { createShell } from './helpers';

const words = (line: string) =>
  tokenize(line).map((t) => (t.type === 'word' ? t.word.parts.map((p) => p.text).join('') : t.op));

describe('command parser', () => {
  it('splits words on whitespace', () => {
    expect(words('  ls   -l  /tmp ')).toEqual(['ls', '-l', '/tmp']);
  });

  it('respects single and double quotes', () => {
    expect(words(`echo "Hello World" 'a  b'`)).toEqual(['echo', 'Hello World', 'a  b']);
    expect(words('echo ""')).toEqual(['echo', '']);
    expect(words('echo a"b c"d')).toEqual(['echo', 'ab cd']);
  });

  it('handles escapes', () => {
    expect(words('touch my\\ file.txt')).toEqual(['touch', 'my file.txt']);
    expect(words('echo "say \\"hi\\""')).toEqual(['echo', 'say "hi"']);
  });

  it('recognises operators without surrounding spaces', () => {
    expect(words('echo hi>f.txt')).toEqual(['echo', 'hi', '>', 'f.txt']);
    expect(words('a&&b;c|d>>e')).toEqual(['a', '&&', 'b', ';', 'c', '|', 'd', '>>', 'e']);
  });

  it('does not treat operators inside quotes as operators', () => {
    expect(words('echo "a > b"')).toEqual(['echo', 'a > b']);
  });

  it('builds pipelines and redirects', () => {
    const items = parse('cat a | grep x > out.txt; ls && pwd');
    expect(items).toHaveLength(3);
    expect(items[0]!.pipeline).toHaveLength(2);
    expect(items[0]!.pipeline[1]!.redirect?.append).toBe(false);
    expect(items[1]!.connector).toBe(';');
    expect(items[2]!.connector).toBe('&&');
  });

  it('reports syntax errors', () => {
    expect(() => tokenize('echo "oops')).toThrowError(/unterminated/);
    expect(() => parse('echo hi >')).toThrowError(/redirect/);
    expect(() => parse('ls |')).toThrowError(/empty command/);
    expect(() => parse('&& ls')).toThrowError(/expected a command/);
  });
});

describe('shell', () => {
  const run = (shell: ReturnType<typeof createShell>['shell'], line: string) => shell.run(line);

  it('starts in the home directory and prints it', () => {
    const { shell } = createShell();
    expect(run(shell, 'pwd').stdout).toBe('/home/user\n');
    expect(shell.prompt).toBe('user@sim-pc:~$ ');
  });

  it('lists the default directories', () => {
    const { shell } = createShell();
    const out = run(shell, 'ls').stdout.split('\n').filter(Boolean);
    expect(out).toEqual(['Desktop', 'Documents', 'Downloads', 'Projects']);
  });

  it('hides dotfiles unless -a is given', () => {
    const { shell } = createShell();
    expect(run(shell, 'ls').stdout).not.toContain('.trash');
    expect(run(shell, 'ls -a').stdout).toContain('.trash');
  });

  it('supports ls -l and listing a path', () => {
    const { shell } = createShell();
    const out = run(shell, 'ls -l Documents').stdout;
    expect(out).toMatch(/^-rw-\s+\S+ B\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+readme\.txt$/m);
    expect(run(shell, 'ls /nope')).toMatchObject({ exitCode: 1, stderr: 'ls: /nope: File not found\n' });
  });

  it('cd changes the directory, supports .., ~ and -', () => {
    const { shell } = createShell();
    expect(run(shell, 'cd Documents').exitCode).toBe(0);
    expect(shell.cwd).toBe('/home/user/Documents');
    run(shell, 'cd ..');
    expect(shell.cwd).toBe('/home/user');
    run(shell, 'cd /etc');
    run(shell, 'cd ~');
    expect(shell.cwd).toBe('/home/user');
    run(shell, 'cd -');
    expect(shell.cwd).toBe('/etc');
    run(shell, 'cd');
    expect(shell.cwd).toBe('/home/user');
  });

  it('cd fails on missing directories and files', () => {
    const { shell } = createShell();
    expect(run(shell, 'cd nowhere').stderr).toContain('File not found');
    expect(run(shell, 'cd Documents/readme.txt').stderr).toContain('Not a directory');
    expect(shell.cwd).toBe('/home/user');
  });

  it('runs the example session from the spec', () => {
    const { shell } = createShell();
    expect(run(shell, 'mkdir test').exitCode).toBe(0);
    run(shell, 'cd test');
    expect(shell.cwd).toBe('/home/user/test');
    expect(run(shell, 'touch hello.txt').exitCode).toBe(0);
    run(shell, 'echo "Hello World" > hello.txt');
    expect(run(shell, 'cat hello.txt').stdout.trim()).toBe('Hello World');
  });

  it('mkdir -p creates nested directories, mkdir fails without it', () => {
    const { shell, computer } = createShell();
    expect(run(shell, 'mkdir a/b/c').exitCode).toBe(1);
    expect(run(shell, 'mkdir -p a/b/c').exitCode).toBe(0);
    expect(computer.fileSystem.isDirectory('/home/user/a/b/c')).toBe(true);
    expect(run(shell, 'mkdir a').stderr).toContain('Already exists');
  });

  it('touch creates files and keeps content of existing ones', () => {
    const { shell, computer } = createShell();
    run(shell, 'touch a.txt b.txt');
    expect(computer.fileSystem.exists('/home/user/a.txt')).toBe(true);
    run(shell, 'echo data > a.txt');
    run(shell, 'touch a.txt');
    expect(computer.fileSystem.readFile('/home/user/a.txt')).toBe('data\n');
  });

  it('echo prints, redirects and appends', () => {
    const { shell, computer } = createShell();
    expect(run(shell, 'echo one   two').stdout).toBe('one two\n');
    expect(run(shell, 'echo -n hi').stdout).toBe('hi');
    run(shell, 'echo first > f.txt');
    run(shell, 'echo second >> f.txt');
    expect(computer.fileSystem.readFile('/home/user/f.txt')).toBe('first\nsecond\n');
    run(shell, 'echo replaced > f.txt');
    expect(computer.fileSystem.readFile('/home/user/f.txt')).toBe('replaced\n');
  });

  it('expands environment variables and respects single quotes', () => {
    const { shell } = createShell();
    expect(run(shell, 'echo $HOME $USER').stdout).toBe('/home/user user\n');
    expect(run(shell, `echo '$HOME'`).stdout).toBe('$HOME\n');
  });

  it('cat reads files and reports missing ones', () => {
    const { shell } = createShell();
    expect(run(shell, 'cat Documents/readme.txt').stdout).toContain('Welcome to Computer Simulator');
    expect(run(shell, 'cat missing.txt')).toMatchObject({ exitCode: 1, stderr: 'cat: missing.txt: File not found\n' });
    expect(run(shell, 'cat Documents').stderr).toContain('Is a directory');
  });

  it('rm moves files to the trash and rm -P deletes them for good', () => {
    const { shell, computer } = createShell();
    run(shell, 'touch a.txt b.txt');
    expect(run(shell, 'rm a.txt').exitCode).toBe(0);
    expect(computer.fileSystem.exists('/home/user/a.txt')).toBe(false);
    expect(computer.fileSystem.listTrash().map((t) => t.name)).toEqual(['a.txt']);
    run(shell, 'rm -P b.txt');
    expect(computer.fileSystem.listTrash()).toHaveLength(1);
    expect(run(shell, 'trash restore a.txt').exitCode).toBe(0);
    expect(computer.fileSystem.exists('/home/user/a.txt')).toBe(true);
  });

  it('rm needs -r for directories and -f silences missing files', () => {
    const { shell, computer } = createShell();
    run(shell, 'mkdir -p d/e');
    expect(run(shell, 'rm d').stderr).toContain('Is a directory');
    expect(run(shell, 'rm -r d').exitCode).toBe(0);
    expect(computer.fileSystem.exists('/home/user/d')).toBe(false);
    expect(run(shell, 'rm nope.txt').exitCode).toBe(1);
    expect(run(shell, 'rm -f nope.txt').exitCode).toBe(0);
  });

  it('protects system files', () => {
    const { shell } = createShell();
    expect(run(shell, 'rm /etc/motd').stderr).toContain('Permission denied');
    expect(run(shell, 'echo x > /etc/motd').stderr).toContain('Permission denied');
    expect(run(shell, 'touch /system/new').stderr).toContain('Permission denied');
  });

  it('rmdir removes only empty directories', () => {
    const { shell, computer } = createShell();
    run(shell, 'mkdir -p d/e');
    expect(run(shell, 'rmdir d').stderr).toContain('Directory not empty');
    expect(run(shell, 'rmdir d/e').exitCode).toBe(0);
    expect(computer.fileSystem.exists('/home/user/d/e')).toBe(false);
  });

  it('mv moves and renames, cp copies', () => {
    const { shell, computer } = createShell();
    run(shell, 'echo hi > a.txt');
    run(shell, 'mv a.txt b.txt');
    expect(computer.fileSystem.exists('/home/user/a.txt')).toBe(false);
    run(shell, 'mv b.txt Documents');
    expect(computer.fileSystem.readFile('/home/user/Documents/b.txt')).toBe('hi\n');
    run(shell, 'cp Documents/b.txt c.txt');
    expect(computer.fileSystem.readFile('/home/user/c.txt')).toBe('hi\n');
    expect(run(shell, 'cp Documents copy').stderr).toContain('Is a directory');
    expect(run(shell, 'cp -r Documents copy').exitCode).toBe(0);
    expect(computer.fileSystem.exists('/home/user/copy/b.txt')).toBe(true);
  });

  it('rename changes the name in place', () => {
    const { shell, computer } = createShell();
    run(shell, 'touch a.txt');
    run(shell, 'rename a.txt z.txt');
    expect(computer.fileSystem.exists('/home/user/z.txt')).toBe(true);
    expect(run(shell, 'rename missing x').exitCode).toBe(1);
  });

  it('tree draws the hierarchy', () => {
    const { shell } = createShell();
    run(shell, 'mkdir -p t/sub');
    run(shell, 'touch t/sub/x.txt t/y.txt');
    const out = run(shell, 'tree t').stdout;
    expect(out).toBe('t\n├── sub\n│   └── x.txt\n└── y.txt\n\n1 directory, 2 files\n');
  });

  it('find filters by name and type', () => {
    const { shell } = createShell();
    const byName = run(shell, 'find . -name "*.txt"').stdout.split('\n').filter(Boolean);
    expect(byName).toEqual(['./Documents/readme.txt', './Projects/hello.txt']);
    expect(run(shell, 'find Projects -type d').stdout).toBe('Projects\n');
  });

  it('expands globs', () => {
    const { shell } = createShell();
    run(shell, 'touch a.log b.log c.txt');
    run(shell, 'rm *.log');
    expect(run(shell, 'ls').stdout).toContain('c.txt');
    expect(run(shell, 'ls').stdout).not.toContain('a.log');
  });

  it('supports pipes, && and ;', () => {
    const { shell } = createShell();
    expect(run(shell, 'cat Documents/readme.txt | grep -i welcome').stdout).toContain('Welcome');
    expect(run(shell, 'echo a; echo b').stdout).toBe('a\nb\n');
    expect(run(shell, 'mkdir x && cd x && pwd').stdout).toBe('/home/user/x\n');
    expect(run(shell, 'cd nope && echo unreachable').stdout).toBe('');
    expect(run(shell, 'ls /home/user/Documents | wc -l').stdout.trim()).toBe('1');
  });

  it('reports unknown commands', () => {
    const { shell } = createShell();
    const r = run(shell, 'frobnicate now');
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toContain('Invalid command: frobnicate');
  });

  it('never throws on malformed input', () => {
    const { shell } = createShell();
    for (const line of ['echo "x', '|', '> >', 'cat <<', 'ls &&', '((']) {
      expect(() => shell.run(line)).not.toThrow();
    }
  });

  it('whoami, date, uname and history', () => {
    const { shell } = createShell();
    expect(run(shell, 'whoami').stdout).toBe('user\n');
    expect(run(shell, 'uname -a').stdout).toContain('sim-pc');
    expect(run(shell, 'date').stdout).toMatch(/\d{2}:\d{2}:\d{2}/);
    run(shell, 'pwd');
    expect(run(shell, 'history').stdout).toMatch(/1 {2}whoami[\s\S]*pwd/);
    run(shell, 'history -c');
    expect(shell.history).toHaveLength(0);
  });

  it('ps lists processes and kill terminates them', () => {
    const { shell, computer } = createShell();
    const { pid } = computer.launch('files');
    expect(run(shell, 'ps').stdout).toContain('files');
    expect(run(shell, `kill ${pid}`).stdout).toContain(`Killed files (${pid})`);
    expect(computer.processManager.has(pid)).toBe(false);
    expect(run(shell, `kill ${pid}`).stderr).toContain('Process not found');
    expect(run(shell, 'kill 1').stderr).toContain('Permission denied');
    expect(run(shell, 'kill abc').exitCode).toBe(1);
  });

  it('memory and cpu report real numbers', () => {
    const { shell, computer } = createShell();
    const mem = run(shell, 'memory').stdout;
    expect(mem).toContain(`Total: ${computer.memory.totalMB} MB`);
    expect(mem).toContain(`Used:  ${Math.round(computer.memory.usedMB)} MB`);
    expect(run(shell, 'cpu').stdout).toContain('Cores:     4');
  });

  it('disk full is reported by fallocate', () => {
    const { shell } = createShell();
    expect(run(shell, 'fallocate big.bin 5G').exitCode).toBe(0);
    expect(run(shell, 'fallocate huge.bin 50G').stderr).toContain('Disk is full');
  });

  it('help lists commands and new commands can be registered without touching the shell', () => {
    const { shell } = createShell();
    expect(run(shell, 'help').stdout).toContain('mkdir');
    const hello: Command = {
      name: 'hello',
      description: 'Greets',
      execute: (args) => ({ stdout: `hello ${args.join(' ')}\n`, stderr: '', exitCode: 0 }),
    };
    shell.registry.register(hello);
    expect(run(shell, 'hello world').stdout).toBe('hello world\n');
    expect(run(shell, 'help hello').stdout).toContain('Greets');
  });

  it('completes commands and paths', () => {
    const { shell } = createShell();
    expect(shell.complete('mkd').candidates).toEqual(['mkdir']);
    expect(shell.complete('cd Doc')).toEqual({ start: 3, candidates: ['Documents/'] });
    expect(shell.complete('cat Documents/re').candidates).toEqual(['Documents/readme.txt']);
  });

  it('clear asks the terminal to wipe the screen', () => {
    const { shell } = createShell();
    expect(run(shell, 'clear').clear).toBe(true);
  });
});
