import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { uiScale } from '../lib/ui-scale.ts';

/**
 * A vertical list reordered by a grip handle (pointer) or the keyboard.
 *
 * While dragging, the lifted card follows the pointer and the cards it passes
 * spring aside to open a gap; on drop the list reorders and every card slides
 * from where it was drawn to its new slot (FLIP), so the dropped card lands in
 * the gap instead of jumping. Reordering only changes local state: the page
 * saves the whole draft later.
 *
 * Rects and pointer coordinates are visual pixels; transforms are layout
 * pixels under the root zoom, so measurements are divided by the UI scale.
 */

export interface HandleProps {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  'aria-label': string;
  'aria-roledescription': string;
  'data-sort-handle': true;
  tabIndex: 0;
}

interface Drag { from: number; over: number; startY: number; dy: number; slot: number; pointer: number }

export function SortableList<T>({ items, keyOf, onMove, label, className = 'order-list', children }: {
  items: T[];
  keyOf: (item: T) => string;
  onMove: (from: number, to: number) => void;
  label: (item: T) => string;
  className?: string;
  children: (item: T, index: number, handle: HandleProps) => ReactNode;
}) {
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const settle = useRef<{ tops: Map<string, number>; moved: string } | null>(null);
  const focusKey = useRef<string | null>(null);

  // FLIP after a reorder: start each card where it was drawn, then let it spring home.
  useLayoutEffect(() => {
    const pending = settle.current;
    if (!pending) return;
    settle.current = null;
    const scale = uiScale();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const [key, el] of nodes.current) {
      const before = pending.tops.get(key);
      if (before === undefined) continue;
      const delta = (before - el.getBoundingClientRect().top) / scale;
      el.style.transition = 'none';
      el.style.transform = delta ? `translateY(${delta}px)` : '';
      if (key === pending.moved) el.dataset.landing = 'true';
    }
    if (focusKey.current) nodes.current.get(focusKey.current)?.querySelector<HTMLElement>('[data-sort-handle]')?.focus();
    focusKey.current = null;
    void document.body.offsetHeight; // commit the start positions before animating
    for (const el of nodes.current.values()) {
      el.style.transition = reduce ? 'none' : '';
      el.style.transform = '';
    }
    const landed = nodes.current.get(pending.moved);
    if (landed) window.setTimeout(() => { delete landed.dataset.landing; }, reduce ? 0 : 420);
  });

  const snapshot = () => new Map([...nodes.current].map(([key, el]) => [key, el.getBoundingClientRect().top]));
  const commit = (from: number, to: number, keyboard = false) => {
    if (from === to || to < 0 || to >= items.length) return;
    settle.current = { tops: snapshot(), moved: keyOf(items[from]) };
    if (keyboard) focusKey.current = keyOf(items[from]);
    onMove(from, to);
  };

  const start = (index: number) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const el = nodes.current.get(keyOf(items[index]));
    if (!el) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const scale = uiScale();
    const next = el.nextElementSibling as HTMLElement | null;
    const slot = next ? (next.getBoundingClientRect().top - el.getBoundingClientRect().top) / scale : el.getBoundingClientRect().height / scale + 4;
    setDrag({ from: index, over: index, startY: event.clientY, dy: 0, slot, pointer: event.pointerId });
  };
  const move = (event: PointerEvent<HTMLUListElement | HTMLOListElement>) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dy = (event.clientY - drag.startY) / uiScale();
    const over = Math.max(0, Math.min(items.length - 1, drag.from + Math.round(dy / drag.slot)));
    setDrag({ ...drag, dy, over });
  };
  const end = (event: PointerEvent<HTMLUListElement | HTMLOListElement>, cancel = false) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { from, over } = drag;
    if (!cancel && from !== over) {
      settle.current = { tops: snapshot(), moved: keyOf(items[from]) };
      setDrag(null);
      onMove(from, over);
    } else setDrag(null);
  };

  const offset = (index: number) => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < index && index <= drag.over) return -drag.slot;
    if (drag.over <= index && index < drag.from) return drag.slot;
    return 0;
  };

  return (
    <ol className={`sortable ${className}`} data-dragging={!!drag} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)}>
      {items.map((item, index) => {
        const key = keyOf(item);
        const lifted = drag?.from === index;
        const handle: HandleProps = {
          onPointerDown: start(index),
          onKeyDown: event => {
            if (event.key === 'ArrowUp') { event.preventDefault(); commit(index, index - 1, true); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); commit(index, index + 1, true); }
          },
          'aria-label': `拖动调整「${label(item)}」的顺序，或按上下方向键`,
          'aria-roledescription': '排序抓手',
          'data-sort-handle': true,
          tabIndex: 0,
        };
        const shift = offset(index);
        return (
          <li key={key} ref={el => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); }} data-lifted={lifted || undefined} data-shifted={drag && !lifted && shift !== 0 ? true : undefined}
            style={drag ? { transform: shift ? `translateY(${shift}px)` : undefined } : undefined}>
            {children(item, index, handle)}
          </li>
        );
      })}
    </ol>
  );
}

/** Six-dot grip. */
export function Grip(props: HandleProps) {
  return <span className="sort-grip" role="button" {...props}><svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">{[3, 8, 13].flatMap(y => [3, 9].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />))}</svg></span>;
}
