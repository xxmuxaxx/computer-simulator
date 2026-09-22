import { useEffect, useMemo, useRef, useState } from 'react';
import { appRegistry } from '../../apps';
import { AppIcon, Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { useInstalledApps } from '../../hooks/useObservable';
import { useUIStore } from '../../store/uiStore';
import { launchApp } from '../actions';

export function Launcher() {
  const computer = useComputer();
  const open = useUIStore((s) => s.launcherOpen);
  const setOpen = useUIStore((s) => s.setLauncherOpen);
  const installed = useInstalledApps();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => appRegistry.search(query, installed), [query, installed]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, setOpen]);

  if (!open) return null;

  const run = (id: string) => {
    setOpen(false);
    launchApp(computer, id);
  };

  return (
    <div
      ref={ref}
      className="launcher"
      role="dialog"
      aria-label="Application launcher"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
        else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setIndex((i) => Math.min(results.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setIndex((i) => Math.max(0, i - 1));
        } else if (e.key === 'Enter' && results[index]) run(results[index]!.id);
      }}
    >
      <div className="launcher-search">
        <Icon name="search" size={16} />
        <input
          ref={input}
          value={query}
          placeholder="Search applications..."
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          spellCheck={false}
        />
      </div>
      <div className="launcher-list" role="listbox">
        {results.length === 0 && <div className="empty">No applications match "{query}"</div>}
        {results.map((app, i) => (
          <button
            key={app.id}
            role="option"
            aria-selected={i === index}
            className={`launcher-item${i === index ? ' selected' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => run(app.id)}
          >
            <AppIcon name={app.icon} size={34} />
            <span className="launcher-text">
              <strong>{app.name}</strong>
              <small>{app.description}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
