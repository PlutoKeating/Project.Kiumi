import { useEffect, useState, type CSSProperties } from 'react';
import { caretLine, isRotated, lineEnd, nearestTo, nextLineStart, paperScale } from '../lib/caret.ts';

/** Thickness and minimum length on screen, whatever the shell or canvas zoom is. */
const CORE_PX = 2;
const MIN_LENGTH_PX = 20;

type Bar = { left: number; top: number; width: number; height: number; px: number };

/**
 * Browsers draw a fixed hairline caret and CSS can only recolour it, which disappears against
 * template text. While a block is edited inline this draws the caret instead. It lives inside the
 * paper, so it scrolls with the article and passes under the glass like the text does.
 */
export function InlineCaret({ target, zoom }: { target: HTMLElement | null; zoom: number }) {
  const [bar, setBar] = useState<Bar | null>(null);

  useEffect(() => {
    const paper = target?.closest<HTMLElement>('.paper');
    if (!target || !paper || isRotated(target)) return;
    const block = target.closest('.editor-block');
    target.style.caretColor = 'transparent';

    // Only how the caret got to a soft wrap tells which side of it the browser shows.
    let side = nextLineStart;
    const onKey = (event: KeyboardEvent) => { side = event.key === 'End' ? lineEnd : nextLineStart; };
    const onPointer = (event: PointerEvent) => { side = nearestTo(event.clientY); };

    const update = () => {
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !selection?.isCollapsed || document.activeElement !== target || !target.contains(range.startContainer)) {
        setBar(null);
        return;
      }
      const scale = paperScale(paper), origin = paper.getBoundingClientRect(), line = caretLine(range, scale, side);
      const px = 1 / scale, thickness = CORE_PX * px, minLength = MIN_LENGTH_PX * px;
      const left = (line.left - origin.left) * px, top = (line.top - origin.top) * px;
      const width = line.width * px, height = line.height * px;
      if (width > height) {
        const length = Math.max(width, minLength);
        setBar({ left: left - (length - width) / 2, top: top - thickness / 2, width: length, height: thickness, px });
      } else {
        const length = Math.max(height, minLength);
        setBar({ left: left - thickness / 2, top: top - (length - height) / 2, width: thickness, height: length, px });
      }
    };

    update();
    target.addEventListener('keydown', onKey);
    target.addEventListener('pointerdown', onPointer);
    document.addEventListener('selectionchange', update);
    // Forward delete and image loads reflow the line without moving the selection.
    target.addEventListener('input', update);
    window.addEventListener('resize', update);
    // A freshly inserted block is still sliding in if it's edited straight away.
    block?.addEventListener('animationend', update);
    const resize = new ResizeObserver(update);
    resize.observe(paper);
    return () => {
      target.removeEventListener('keydown', onKey);
      target.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('selectionchange', update);
      target.removeEventListener('input', update);
      window.removeEventListener('resize', update);
      block?.removeEventListener('animationend', update);
      resize.disconnect();
      target.style.removeProperty('caret-color');
      setBar(null);
    };
  }, [target, zoom]);

  if (!bar) return null;
  const { px, ...box } = bar;
  // Remounting on every move restarts the blink, so the caret stays solid while typing.
  return <span className="inline-caret" aria-hidden="true" key={`${box.left}:${box.top}`} style={{ ...box, '--caret-px': `${px}px` } as CSSProperties} />;
}
