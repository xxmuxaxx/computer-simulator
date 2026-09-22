import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useComputer } from '../../hooks/useComputer';
import { useSettings } from '../../hooks/useObservable';
import { Shell } from '../../core/shell/Shell';
import { tildify } from '../../utils/path';
import { HOME } from '../../core/filesystem/seed';
import type { AppProps } from '../types';
import './terminal.css';

type Line = { id: number; kind: 'prompt' | 'out' | 'err' | 'info'; text: string };

const MAX_LINES = 2000;
const BANNER = 'Computer Simulator Terminal. Type "help" to list the available commands.';

const commonPrefix = (items: string[]): string => {
  let prefix = items[0] ?? '';
  for (const s of items) while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
};

export function TerminalApp({ windowId, args }: AppProps) {
  const computer = useComputer();
  const settings = useSettings();
  const shell = useMemo(() => new Shell(computer, { cwd: typeof args.cwd === 'string' && computer.fileSystem.isDirectory(args.cwd) ? args.cwd : undefined }), [computer, args.cwd]);
  const nextId = useRef(1);
  const mk = (kind: Line['kind'], text: string): Line => ({ id: nextId.current++, kind, text });
  const [lines, setLines] = useState<Line[]>(() => [{ id: 0, kind: 'info', text: BANNER }]);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(-1); // index into history while browsing, -1 = the live line
  const draft = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The prompt reflects the live user/computer name and the current directory.
  const prompt = `${settings.userName}@${settings.computerName}:${tildify(shell.cwd, HOME)}$ `;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    computer.windowManager.setArgs(windowId, { cwd: shell.cwd });
  });

  const push = (added: Line[], reset = false) =>
    setLines((prev) => (reset ? added : [...prev, ...added]).slice(-MAX_LINES));

  const splitOutput = (kind: Line['kind'], text: string): Line[] => {
    if (text === '') return [];
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    return body.split('\n').map((t) => mk(kind, t));
  };

  const submit = () => {
    const command = input;
    const echo = mk('prompt', prompt + command);
    setInput('');
    setCursor(-1);
    if (command.trim() === '') return push([echo]);
    let result;
    try {
      result = shell.run(command);
    } catch (e) {
      // Commands should never throw, but a bug in one must not break the terminal.
      result = { stdout: '', stderr: `Internal error: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1, clear: false };
    }
    if (result.clear) return push([], true);
    push([echo, ...splitOutput('out', result.stdout), ...splitOutput('err', result.stderr)]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const history = shell.history;
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = cursor === -1 ? history.length - 1 : Math.max(0, cursor - 1);
      if (cursor === -1) draft.current = input;
      setCursor(next);
      setInput(history[next]!);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor === -1) return;
      if (cursor >= history.length - 1) {
        setCursor(-1);
        setInput(draft.current);
      } else {
        setCursor(cursor + 1);
        setInput(history[cursor + 1]!);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const { start, candidates } = shell.complete(input);
      if (candidates.length === 0) return;
      const prefix = commonPrefix(candidates);
      if (candidates.length === 1) {
        const only = candidates[0]!;
        setInput(input.slice(0, start) + only + (only.endsWith('/') ? '' : ' '));
      } else {
        if (prefix.length > input.length - start) setInput(input.slice(0, start) + prefix);
        else push([mk('prompt', prompt + input), mk('out', candidates.join('   '))]);
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      push([], true);
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      push([mk('prompt', prompt + input + '^C')]);
      setInput('');
      setCursor(-1);
    }
  };

  return (
    <div className="terminal" onClick={() => !window.getSelection()?.toString() && inputRef.current?.focus()}>
      <div className="terminal-scroll" ref={scrollRef}>
        {lines.map((l) => (
          <div key={l.id} className={`tline tline-${l.kind}`}>
            {l.text || ' '}
          </div>
        ))}
        <div className="tline tline-input">
          <span className="tprompt">{prompt}</span>
          <input
            ref={inputRef}
            className="tinput"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Terminal input"
          />
        </div>
      </div>
    </div>
  );
}
