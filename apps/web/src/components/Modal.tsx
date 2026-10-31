import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Portals keep dialogs outside the scrolling, translucent editor chrome. */
export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = root.current!;
    const focusable = () => [...element.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"],[contenteditable="true"]')].filter(el => el.getClientRects().length);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (event.target as HTMLElement).closest('[data-confirmation]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return createPortal(<div ref={root} className="modal-backdrop" onClick={onClose}>{children}</div>, document.body);
}
