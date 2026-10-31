/** Moves the specular highlight of glass and candy surfaces with the pointer. One listener, one write per frame. */
export function startGlint(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let frame = 0;
  window.addEventListener('pointermove', event => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const target = (event.target as Element | null)?.closest?.<HTMLElement>('[data-glint]');
      if (!target) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${event.clientX - box.left}px`);
      target.style.setProperty('--my', `${event.clientY - box.top}px`);
    });
  }, { passive: true });
}
