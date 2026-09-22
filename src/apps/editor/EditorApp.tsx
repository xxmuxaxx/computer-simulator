import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { HOME } from '../../core/filesystem/seed';
import { useComputer } from '../../hooks/useComputer';
import { useWindowCommands } from '../../hooks/windowCommands';
import { dialogs } from '../../store/uiStore';
import { basename, dirname, normalize } from '../../utils/path';
import { uid } from '../../utils/id';
import type { AppProps } from '../types';
import { EditorSurface, LINE_HEIGHT } from './EditorSurface';
import './editor.css';

interface Tab {
  id: string;
  path: string | null;
  name: string;
  content: string;
  saved: string;
}

export function EditorApp({ windowId, args }: AppProps) {
  const computer = useComputer();
  const fs = computer.fileSystem;
  const wm = computer.windowManager;

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const dirty = (t: Tab) => t.content !== t.saved;
  const anyDirty = tabs.some(dirty);

  const untitledName = (existing: Tab[]) => {
    const names = new Set(existing.map((t) => t.name));
    if (!names.has('Untitled')) return 'Untitled';
    for (let i = 2; ; i++) if (!names.has(`Untitled ${i}`)) return `Untitled ${i}`;
  };

  const addTab = useCallback((tab: Omit<Tab, 'id'>) => {
    const t = { ...tab, id: uid('tab') };
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
    return t;
  }, []);

  const newTab = useCallback(() => {
    addTab({ path: null, name: untitledName(tabsRef.current), content: '', saved: '' });
  }, [addTab]);

  const openFile = useCallback(
    (path: string) => {
      const target = normalize(path);
      const existing = tabsRef.current.find((t) => t.path === target);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const content = computer.attempt(() => fs.readFile(target));
      if (content === undefined) return;
      addTab({ path: target, name: basename(target), content, saved: content });
    },
    [addTab, computer, fs],
  );

  // Initial tab(s): the file from the launch arguments, or an empty document.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (typeof args.path === 'string' && fs.isFile(args.path)) openFile(args.path);
    else newTab();
  }, [args.path, fs, newTab, openFile]);

  useEffect(() => {
    wm.setDirty(windowId, anyDirty);
    return () => wm.setDirty(windowId, false);
  }, [wm, windowId, anyDirty]);

  useEffect(() => {
    if (!active) return;
    wm.setTitle(windowId, `${active.name}${dirty(active) ? ' *' : ''} - Text Editor`);
    wm.setArgs(windowId, { path: active.path ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wm, windowId, active?.name, active?.path, active && dirty(active)]);

  const update = (id: string, patch: Partial<Tab>) => setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const writeTab = (tab: Tab, path: string): boolean => {
    try {
      fs.writeFile(path, tab.content);
      update(tab.id, { path, name: basename(path), saved: tab.content });
      computer.notifications.success('File saved', basename(path));
      return true;
    } catch (e) {
      computer.reportError(e);
      return false;
    }
  };

  const saveAs = async (tab: Tab | null = active): Promise<boolean> => {
    if (!tab) return false;
    const suggested = tab.path ? basename(tab.path) : tab.name.includes('.') ? tab.name : `${tab.name.toLowerCase().replace(/\s+/g, '-')}.txt`;
    const chosen = await dialogs.pickFile({
      mode: 'save',
      initialDir: tab.path ? dirname(tab.path) : `${HOME}/Documents`,
      defaultName: suggested,
    });
    if (!chosen) return false;
    if (fs.isDirectory(chosen)) {
      computer.notifications.error('Cannot save', `${chosen} is a folder`);
      return false;
    }
    if (fs.exists(chosen) && chosen !== tab.path) {
      const overwrite = await dialogs.confirm({
        title: 'Replace file?',
        message: `"${basename(chosen)}" already exists. Do you want to replace it?`,
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!overwrite) return false;
    }
    return writeTab(tab, chosen);
  };

  const save = async (tab: Tab | null = active): Promise<boolean> => {
    if (!tab) return false;
    if (!tab.path) return saveAs(tab);
    return writeTab(tab, tab.path);
  };

  const open = async () => {
    const chosen = await dialogs.pickFile({ mode: 'open', initialDir: active?.path ? dirname(active.path) : `${HOME}/Documents` });
    if (chosen) openFile(chosen);
  };

  const closeTab = async (tab: Tab) => {
    if (dirty(tab)) {
      setActiveId(tab.id);
      const choice = await dialogs.choose({
        title: 'Save changes?',
        message: `"${tab.name}" has unsaved changes.`,
        buttons: [
          { label: 'Cancel', value: 'cancel' },
          { label: "Don't save", value: 'discard', variant: 'danger' },
          { label: 'Save', value: 'save', variant: 'primary' },
        ],
      });
      if (choice === null || choice === 'cancel') return;
      if (choice === 'save' && !(await save(tab))) return;
    }
    const remaining = tabsRef.current.filter((t) => t.id !== tab.id);
    if (remaining.length === 0) {
      const t = { id: uid('tab'), path: null, name: 'Untitled', content: '', saved: '' };
      setTabs([t]);
      setActiveId(t.id);
    } else {
      setTabs(remaining);
      if (activeId === tab.id) {
        const idx = tabsRef.current.findIndex((t) => t.id === tab.id);
        setActiveId(remaining[Math.min(idx, remaining.length - 1)]!.id);
      }
    }
  };

  const openFind = () => {
    setFindOpen(true);
    requestAnimationFrame(() => {
      findRef.current?.focus();
      findRef.current?.select();
    });
  };

  useWindowCommands(windowId, {
    save: () => void save(),
    saveAs: () => void saveAs(),
    newFile: newTab,
    open: () => void open(),
    find: openFind,
  });

  const matches = useMemo(() => {
    if (!findOpen || !query || !active) return [];
    const haystack = caseSensitive ? active.content : active.content.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    const out: [number, number][] = [];
    for (let i = haystack.indexOf(needle); i !== -1 && out.length < 5000; i = haystack.indexOf(needle, i + needle.length)) {
      out.push([i, i + needle.length]);
    }
    return out;
  }, [findOpen, query, caseSensitive, active]);

  const current = matches.length ? Math.min(matchIndex, matches.length - 1) : -1;

  const reveal = (index: number) => {
    const ta = areaRef.current;
    const m = matches[index];
    if (!ta || !m || !active) return;
    const line = active.content.slice(0, m[0]).split('\n').length - 1;
    const top = line * LINE_HEIGHT;
    if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - LINE_HEIGHT * 2) {
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
    }
  };

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (current + dir + matches.length) % matches.length;
    setMatchIndex(next);
    reveal(next);
  };

  // Jump to the first match while typing.
  useEffect(() => {
    setMatchIndex(0);
    if (matches.length) reveal(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive]);

  const updateCursor = () => {
    const ta = areaRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const lines = before.split('\n');
    setCursor({ line: lines.length, col: lines[lines.length - 1]!.length + 1 });
  };

  if (!active) return <div className="editor" />;

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button className="icon-btn" title="New (Ctrl+N)" aria-label="New file" onClick={newTab}>
          <Icon name="file-plus" />
        </button>
        <button className="icon-btn" title="Open (Ctrl+O)" aria-label="Open file" onClick={() => void open()}>
          <Icon name="folder-open" />
        </button>
        <button className="icon-btn" title="Save (Ctrl+S)" aria-label="Save" onClick={() => void save()}>
          <Icon name="save" />
        </button>
        <button className="btn btn-ghost" title="Save As (Ctrl+Shift+S)" onClick={() => void saveAs()}>
          Save As...
        </button>
        <span className="grow" />
        <button className={`icon-btn${findOpen ? ' on' : ''}`} title="Find (Ctrl+F)" aria-label="Find" onClick={() => (findOpen ? setFindOpen(false) : openFind())}>
          <Icon name="search" />
        </button>
      </div>

      <div className="editor-tabs" role="tablist">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            className={`etab${t.id === activeId ? ' active' : ''}`}
            onClick={() => setActiveId(t.id)}
            onAuxClick={(e) => e.button === 1 && void closeTab(t)}
            title={t.path ?? t.name}
          >
            <Icon name="file-text" size={14} />
            <span className="etab-name">{t.name}</span>
            {dirty(t) && <span className="dirty-dot" title="Unsaved changes" />}
            <button
              className="etab-close"
              aria-label={`Close ${t.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(t);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button className="etab-new" aria-label="New tab" title="New tab" onClick={newTab}>
          <Icon name="plus" size={14} />
        </button>
      </div>

      {findOpen && (
        <div className="find-bar" role="search">
          <input
            ref={findRef}
            className="input"
            placeholder="Find..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
              else if (e.key === 'Escape') {
                setFindOpen(false);
                areaRef.current?.focus();
              }
            }}
          />
          <span className="find-count">{query ? (matches.length ? `${current + 1} of ${matches.length}` : 'No results') : ''}</span>
          <button className="icon-btn" aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => step(-1)} disabled={!matches.length}>
            <Icon name="up" size={14} />
          </button>
          <button className="icon-btn" aria-label="Next match" title="Next (Enter)" onClick={() => step(1)} disabled={!matches.length}>
            <Icon name="chevron" size={14} className="rot90" />
          </button>
          <button className={`btn btn-ghost${caseSensitive ? ' on' : ''}`} title="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}>
            Aa
          </button>
          <button className="icon-btn" aria-label="Close find" onClick={() => setFindOpen(false)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <EditorSurface
        key={active.id}
        textareaRef={areaRef}
        value={active.content}
        matches={matches}
        current={current}
        onChange={(content) => update(active.id, { content })}
        onCursor={updateCursor}
      />

      <div className="editor-status">
        <span>{active.path ?? 'Not saved yet'}</span>
        <span className="grow" />
        {dirty(active) && <span className="modified">Modified</span>}
        <span>
          Ln {cursor.line}, Col {cursor.col}
        </span>
        <span>{active.content.length} chars</span>
      </div>
    </div>
  );
}

