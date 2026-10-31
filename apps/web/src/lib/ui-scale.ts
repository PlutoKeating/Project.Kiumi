/**
 * The shell is scaled with root `zoom`. Rects and `clientX` are visual pixels while `left`/`top`
 * and `offsetWidth` are layout pixels, so anything positioned from a measurement goes through here.
 */
export const uiScale = (): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;

export function layoutRect(element: Element) {
  const scale = uiScale(), rect = element.getBoundingClientRect();
  return { left: rect.left / scale, right: rect.right / scale, top: rect.top / scale, bottom: rect.bottom / scale, width: rect.width / scale, height: rect.height / scale };
}

export const layoutViewport = () => {
  const scale = uiScale();
  return { width: window.innerWidth / scale, height: window.innerHeight / scale };
};
