import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { layoutRect, layoutViewport } from '../lib/ui-scale.ts';
import { Icon, type IconName } from './Icon.tsx';

/** The signature move: one selection marker slides to the active item, shared by every switcher. */
export function useDroplet(container: RefObject<HTMLElement | null>, active: unknown) {
  const droplet = useRef<HTMLSpanElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const root = container.current, bead = droplet.current;
    if (!root || !bead) return;
    const place = () => {
      const target = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!target) { bead.style.opacity = '0'; return; }
      const x = target.offsetLeft, y = target.offsetTop, width = target.offsetWidth, height = target.offsetHeight;
      bead.style.opacity = '1';
      bead.style.width = `${width}px`; bead.style.height = `${height}px`;
      bead.style.transform = `translate(${x}px, ${y}px)`;
      last.current = { x, y };
    };
    bead.dataset.ready = last.current ? 'true' : 'false';
    place();
    const frame = requestAnimationFrame(() => { bead.dataset.ready = 'true'; });
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [container, active]);
  return droplet;
}

export function Droplet({ bead, tone }: { bead: RefObject<HTMLSpanElement | null>; tone?: string }) {
  return <span ref={bead} className="droplet" data-tone={tone} aria-hidden="true"><i /></span>;
}

export function Segmented<T extends string>({ label, value, options, onChange, disabled }: {
  label: string; value: T; options: readonly { value: T; label: string; disabled?: boolean }[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const bead = useDroplet(root, value);
  return <div ref={root} className="segmented" role="group" aria-label={label}>
    <Droplet bead={bead} />
    {options.map(option => <button key={option.value} type="button" disabled={disabled || option.disabled} aria-pressed={value === option.value} data-active={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function IconButton({ icon, label, tip, size, className = '', ...props }: {
  icon: IconName; label: string; tip?: string; size?: number; className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return <button type="button" aria-label={label} data-tip={tip ?? label} className={`icon-btn ${className}`} {...props}><Icon name={icon} size={size ?? 18} /></button>;
}

/** Sheet header: the title anchors the dialog, close is always in the same corner. */
export function SheetHeader({ title, detail, onClose, disabled }: { title: string; detail?: ReactNode; onClose: () => void; disabled?: boolean }) {
  return <header className="sheet-header">
    <div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>
    <IconButton icon="close" label="关闭" disabled={disabled} onClick={onClose} className="sheet-close" />
  </header>;
}

/** A small glass menu that stays inside the viewport and closes like a native one. */
export function PopMenu({ label, trigger, children, align = 'end' }: { label: string; trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key, true); };
  }, [open]);
  return <div ref={root} className="pop-anchor">
    <button type="button" className="icon-btn" aria-label={label} aria-expanded={open} data-tip={open ? undefined : label} onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && <div className={`pop-menu pop-${align}`} onClick={event => { if ((event.target as HTMLElement).closest('button,a')) setOpen(false); }}>{children}</div>}
  </div>;
}

export interface SelectOption<T> { value: T; label: string; disabled?: boolean }

/** A glass listbox. It portals out of scrolling islands and sheets, and keeps focus on the trigger. */
export function Select<T extends string | number>({ label, value, options, onChange, disabled, variant = 'pill' }: {
  label: string; value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void; disabled?: boolean; variant?: 'pill' | 'field' | 'chip';
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [box, setBox] = useState<ReturnType<typeof layoutRect> | null>(null);
  const currentIndex = options.findIndex(option => option.value === value);
  const show = () => {
    if (disabled || !trigger.current) return;
    setBox(layoutRect(trigger.current)); setActive(Math.max(0, currentIndex)); setOpen(true);
  };
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };
  const step = (from: number, direction: number) => {
    for (let next = from + direction; next >= 0 && next < options.length; next += direction) if (!options[next]?.disabled) return next;
    return from;
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => { if (!list.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const moved = (event: Event) => { if (!list.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away); window.addEventListener('scroll', moved, true); window.addEventListener('resize', moved);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('scroll', moved, true); window.removeEventListener('resize', moved); };
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active]);
  const onKey = (event: ReactKeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') setOpen(false);
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => step(index, 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => step(index, -1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(step(-1, 1)); }
    else if (event.key === 'End') { event.preventDefault(); setActive(step(options.length, -1)); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
  };
  const screen = layoutViewport();
  const below = box ? screen.height - box.bottom : 0, flip = box ? below < 220 && box.top > below : false;
  const width = box ? Math.max(box.width, 168) : 168;
  return <>
    <button ref={trigger} type="button" role="combobox" className={`select-trigger is-${variant}`} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} data-value={value} disabled={disabled} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
      <span>{options[currentIndex]?.label ?? ''}</span><Icon name="chevron" size={13} />
    </button>
    {open && box && createPortal(<div ref={list} id={id} role="listbox" aria-label={label} className="listbox glass-pop" data-flip={flip} style={{ left: Math.max(8, Math.min(box.left, screen.width - width - 8)), width, maxHeight: Math.min(300, (flip ? box.top : below) - 16), ...(flip ? { bottom: screen.height - box.top + 6 } : { top: box.bottom + 6 }) }}>
      {options.map((option, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-${index}`} data-index={index} key={String(option.value)} aria-selected={option.value === value} data-active={index === active} disabled={option.disabled} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === value && <Icon name="check" size={15} />}
      </button>)}
    </div>, document.body)}
  </>;
}

const PALETTE = ['#3f3f3f', '#7a8499', '#2f5fb8', '#6f9bd8', '#6245b8', '#9d8fd9', '#b03a78', '#e58fb3', '#c0583a', '#e8a27c', '#17705a', '#67b8a2', '#a97f12', '#e9c75f', '#ffffff', '#ffe7f1'];

/** Swatches first, because most colour changes are a pick; hex stays available for brand colours. */
export function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (next: string) => { setDraft(next); if (/^#[\da-f]{6}$/i.test(next)) onChange(next.toLowerCase()); };
  return <div className="color-picker">
    <div className="color-swatches" role="group" aria-label={`${label}色板`}>{PALETTE.map(color => <button type="button" key={color} aria-label={color} aria-pressed={value.toLowerCase() === color} style={{ background: color }} onClick={() => commit(color)} />)}</div>
    <label className="tool-field"><span>色值</span><span><input aria-label={label} className="hex-input" value={draft} spellCheck={false} maxLength={7} onChange={event => commit(event.target.value)} /></span></label>
  </div>;
}
