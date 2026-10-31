import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon, type IconName } from './Icon.tsx';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The signature move: one bead of glass slides to the active item and squashes along its travel. */
export function useDroplet(container: RefObject<HTMLElement | null>, active: unknown) {
  const droplet = useRef<HTMLSpanElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const root = container.current, bead = droplet.current;
    if (!root || !bead) return;
    const place = (animate: boolean) => {
      const target = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!target) { bead.style.opacity = '0'; return; }
      const x = target.offsetLeft, y = target.offsetTop, width = target.offsetWidth, height = target.offsetHeight;
      bead.style.opacity = '1';
      bead.style.width = `${width}px`; bead.style.height = `${height}px`;
      bead.style.transform = `translate(${x}px, ${y}px)`;
      const from = last.current;
      if (animate && from && (from.x !== x || from.y !== y) && !reduced()) {
        const horizontal = Math.abs(x - from.x) >= Math.abs(y - from.y);
        const squash = horizontal ? 'scale(1.12, .86)' : 'scale(.9, 1.1)';
        bead.firstElementChild?.animate([{ transform: 'scale(1)' }, { transform: squash, offset: .38 }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(.3, .7, .3, 1)' });
      }
      last.current = { x, y };
    };
    bead.dataset.ready = last.current ? 'true' : 'false';
    place(true);
    const frame = requestAnimationFrame(() => { bead.dataset.ready = 'true'; });
    const observer = new ResizeObserver(() => place(false));
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
