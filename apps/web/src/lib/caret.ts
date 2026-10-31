/** A zero-thickness caret line in visual pixels: width 0 for horizontal text, height 0 for vertical. */
export type CaretLine = { left: number; top: number; width: number; height: number };

const visible = (rect: DOMRect | undefined) => !!rect && (rect.width > 0 || rect.height > 0);

/** The paper's zoom on top of the shell's: visual pixels per layout pixel inside it. */
export const paperScale = (paper: HTMLElement) => paper.getBoundingClientRect().width / paper.offsetWidth;

/** Picks between the two rects a range reports where a line wraps; see `caretLine`. */
export type WrapSide = (rects: DOMRectList) => DOMRect | undefined;
export const nextLineStart: WrapSide = rects => rects[rects.length - 1];
export const lineEnd: WrapSide = rects => rects[0];
export const nearestTo = (y: number): WrapSide => rects => Array.from(rects).sort((a, b) => Math.abs((a.top + a.bottom) / 2 - y) - Math.abs((b.top + b.bottom) / 2 - y))[0];

/**
 * Where the caret of a collapsed range sits. At a soft wrap one DOM position is both the end of a
 * line and the start of the next, and Selection doesn't say which, so the caller picks with `side`.
 * Browsers report no rect on an empty line or in an empty slot, so those fall back to the
 * neighbouring node, then to the element's first line.
 */
export function caretLine(range: Range, scale: number, side: WrapSide = nextLineStart): CaretLine {
  const direct = side(range.getClientRects());
  if (direct && visible(direct)) return direct;

  const node = range.startContainer, offset = range.startOffset;
  const element = node instanceof Element ? node : node.parentElement!;
  const style = getComputedStyle(element);
  const lineHeight = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6) * scale;
  const onLine = (left: number, rect: DOMRect): CaretLine => ({ left, top: rect.top, width: 0, height: Math.min(rect.height || lineHeight, lineHeight) });

  const after = node.childNodes[offset], before = node.childNodes[offset - 1];
  const afterRect = after instanceof Element ? after.getClientRects()[0] : undefined;
  if (afterRect && visible(afterRect)) return onLine(afterRect.left, afterRect);
  const beforeRects = before instanceof Element ? before.getClientRects() : undefined;
  const beforeRect = beforeRects?.[beforeRects.length - 1];
  if (beforeRect && visible(beforeRect)) return onLine(beforeRect.right, beforeRect);

  const box = element.getBoundingClientRect();
  const start = box.left + parseFloat(style.paddingLeft) * scale, end = box.right - parseFloat(style.paddingRight) * scale;
  const left = style.textAlign === 'center' ? (start + end) / 2 : /right|end/.test(style.textAlign) ? end : start;
  return { left, top: box.top + parseFloat(style.paddingTop) * scale, width: 0, height: lineHeight };
}

/** An upright overlay can't follow rotated text; such blocks keep the native caret. */
export function isRotated(element: HTMLElement) {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.rotate !== 'none') return true;
    if (style.transform === 'none') continue;
    const { b, c } = new DOMMatrixReadOnly(style.transform);
    if (b !== 0 || c !== 0) return true;
  }
  return false;
}
