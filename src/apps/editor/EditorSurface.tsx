import { useLayoutEffect, useRef, type RefObject } from 'react';

export const LINE_HEIGHT = 20;

interface Props {
  value: string;
  onChange(value: string): void;
  onCursor(): void;
  matches: readonly [number, number][];
  current: number;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * Plain textarea with a highlight layer behind it (search matches).
 * This is the single place to replace when a real code editor is plugged in:
 * the rest of the editor only depends on { value, onChange, matches }.
 */
export function EditorSurface({ value, onChange, onCursor, matches, current, textareaRef }: Props) {
  const backdrop = useRef<HTMLPreElement>(null);

  const syncScroll = () => {
    const ta = textareaRef.current;
    const bd = backdrop.current;
    if (ta && bd) {
      bd.scrollTop = ta.scrollTop;
      bd.scrollLeft = ta.scrollLeft;
    }
  };

  useLayoutEffect(syncScroll);

  const parts: React.ReactNode[] = [];
  if (matches.length) {
    let pos = 0;
    matches.forEach(([start, end], i) => {
      parts.push(value.slice(pos, start));
      parts.push(
        <mark key={start} className={i === current ? 'current' : undefined}>
          {value.slice(start, end)}
        </mark>,
      );
      pos = end;
    });
    parts.push(value.slice(pos));
  }

  return (
    <div className="editor-surface">
      <pre ref={backdrop} className="editor-backdrop" aria-hidden>
        {matches.length ? parts : null}
        {'\n '}
      </pre>
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={value}
        spellCheck={false}
        autoFocus
        aria-label="Document text"
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onSelect={onCursor}
        onKeyUp={onCursor}
        onClick={onCursor}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            document.execCommand('insertText', false, '  ');
          }
        }}
      />
    </div>
  );
}
