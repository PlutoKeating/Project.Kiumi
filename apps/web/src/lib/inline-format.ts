import { useSyncExternalStore } from 'react';

/**
 * Formatting part of a block while it is edited inline. The block toolbar styles whole blocks through
 * the store; this styles the words selected in the live contenteditable, which the canvas commits
 * with the rest of the edit when it ends.
 */

/** What can differ between words. Alignment, spacing between lines and the like belong to a paragraph. */
export const CHARACTER_STYLES = new Set(['font-family', 'font-size', 'color', 'font-weight', 'font-style', 'text-decoration', 'background-color', 'letter-spacing']);

/** Marks the toolbar controls that act on the selected words, so reaching for them keeps the edit open. */
export const KEEPS_SELECTION = '[data-inline-format], .listbox';

type Snapshot = { html: string; start: number; end: number };
type Session = { element: HTMLElement; range: Range | null; undo: Snapshot[]; stop: () => void };
type Piece = { node: Text; start: number; end: number };

let session: Session | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach(listener => listener()); };

/** Re-renders the caller whenever the selected words or their styles change. */
export const useInlineSelection = () => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => version);

/** The selection stays on screen while a toolbar field holds the focus. */
function paint() {
  if (typeof CSS === 'undefined' || !CSS.highlights) return;
  if (session?.range && document.activeElement !== session.element) CSS.highlights.set('inline-format', new Highlight(session.range));
  else CSS.highlights.delete('inline-format');
}

function pieces(range: Range, root: HTMLElement) {
  const found: Piece[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const node = next as Text;
    if (!range.intersectsNode(node) || !node.data.trim()) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start < end) found.push({ node, start, end });
  }
  return found;
}

/** Innermost wrapper, so it beats whatever the template sets further up. */
function wrapperOf(node: Text, root: HTMLElement) {
  const parent = node.parentElement!;
  if (parent !== root && parent.tagName === 'SPAN' && parent.childNodes.length === 1) return parent;
  const span = document.createElement('span');
  node.replaceWith(span);
  span.append(node);
  return span;
}

const textOffset = (root: HTMLElement, node: Node, offset: number) => {
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(node, offset);
  return before.toString().length;
};

function select(current: Session, range: Range) {
  current.range = range;
  if (document.activeElement === current.element) {
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  paint();
  notify();
}

export function beginInlineFormat(element: HTMLElement) {
  endInlineFormat();
  const onSelection = () => {
    const selection = document.getSelection();
    if (!selection?.rangeCount || !session) return;
    const range = selection.getRangeAt(0);
    // Focus moving to a toolbar field takes the selection with it; keep what was selected here.
    if (!element.contains(range.commonAncestorContainer)) return;
    session.range = range.toString().trim() ? range.cloneRange() : null;
    paint();
    notify();
  };
  const onTyped = () => { if (session) session.undo = []; };
  const onKey = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && undoInlineFormat()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  document.addEventListener('selectionchange', onSelection);
  element.addEventListener('input', onTyped);
  element.addEventListener('keydown', onKey);
  element.addEventListener('focus', paint);
  element.addEventListener('blur', paint);
  session = {
    element, range: null, undo: [],
    stop: () => {
      document.removeEventListener('selectionchange', onSelection);
      element.removeEventListener('input', onTyped);
      element.removeEventListener('keydown', onKey);
      element.removeEventListener('focus', paint);
      element.removeEventListener('blur', paint);
    },
  };
  onSelection();
}

export function endInlineFormat() {
  session?.stop();
  session = null;
  paint();
  notify();
}

export const hasInlineSelection = () => Boolean(session?.range);

/** Whether moving to `target` continues formatting the selected words rather than ending the edit. */
export const keepsInlineEdit = (target: Element | null) => hasInlineSelection() && Boolean(target?.closest(KEEPS_SELECTION));

/** Styles the selected words and leaves them selected. False when no words are selected. */
export function formatInline(styles: Record<string, string>) {
  const current = session, range = current?.range;
  if (!current || !range) return false;
  const found = pieces(range, current.element);
  if (!found.length) return false;
  current.undo.push({ html: current.element.innerHTML, start: textOffset(current.element, range.startContainer, range.startOffset), end: textOffset(current.element, range.endContainer, range.endOffset) });
  const texts = found.map(({ node, start, end }) => {
    if (end < node.length) node.splitText(end);
    return start > 0 ? node.splitText(start) : node;
  });
  for (const node of texts) {
    const wrapper = wrapperOf(node, current.element);
    for (const [property, value] of Object.entries(styles)) wrapper.style.setProperty(property, value);
  }
  const next = document.createRange();
  next.setStart(texts[0]!, 0);
  next.setEnd(texts[texts.length - 1]!, texts[texts.length - 1]!.length);
  select(current, next);
  return true;
}

/** Back to the paragraph's own look: wrappers can't be removed when only part of one is selected. */
export function clearInlineFormat() {
  const element = session?.element;
  if (!element) return false;
  const style = getComputedStyle(element), styles: Record<string, string> = { 'text-decoration': 'none', 'background-color': 'transparent' };
  for (const name of ['font-family', 'font-size', 'color', 'font-weight', 'font-style', 'letter-spacing']) styles[name] = style.getPropertyValue(name);
  return formatInline(styles);
}

/** Inline formatting never reaches the browser's undo stack, so the session keeps its own. */
function undoInlineFormat() {
  const current = session, snapshot = current?.undo.pop();
  if (!current || !snapshot) return false;
  current.element.innerHTML = snapshot.html;
  const range = document.createRange();
  let seen = 0;
  const walker = document.createTreeWalker(current.element, NodeFilter.SHOW_TEXT);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const node = next as Text, after = seen + node.length;
    if (seen <= snapshot.start && snapshot.start < after) range.setStart(node, snapshot.start - seen);
    if (seen < snapshot.end && snapshot.end <= after) range.setEnd(node, snapshot.end - seen);
    seen = after;
  }
  select(current, range);
  return true;
}

const hex = (color: string) => {
  const parts = color.match(/[\d.]+/g)?.map(Number);
  if (!parts || parts.length < 3 || parts[3] === 0) return '';
  return `#${parts.slice(0, 3).map(part => Math.round(part).toString(16).padStart(2, '0')).join('')}`;
};

/** The first selected word's style in the form the toolbar shows; null when no words are selected. */
export function inlineStyle(name: string) {
  const range = session?.range, node = range && session && pieces(range, session.element)[0]?.node;
  if (!node?.parentElement) return null;
  const style = getComputedStyle(node.parentElement);
  if (name === 'font-weight') return Number(style.fontWeight) >= 600 ? 'bold' : 'normal';
  if (name === 'text-decoration') return style.textDecorationLine;
  if (name === 'color' || name === 'background-color') return hex(style.getPropertyValue(name));
  if (name === 'letter-spacing') return style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  return style.getPropertyValue(name);
}
