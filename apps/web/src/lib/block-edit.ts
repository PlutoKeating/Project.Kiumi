import { renderDocument, sanitizeHtml } from '@kiumi/core';
import { useStore } from '../store.ts';

/** Always start from source HTML, never the preview's rewritten/signed URLs. */
export function editBlock(index: number, change: (root: HTMLTemplateElement) => void) {
  const state = useStore.getState(), block = state.doc.blocks[index];
  if (!block) return;
  const root = document.createElement('template');
  root.innerHTML = block.kind === 'library' && block.html ? block.html : renderDocument({ ...state.doc, blocks: [block] }).html;
  change(root);
  const blocks = [...state.doc.blocks];
  blocks[index] = { kind: 'library', id: block.id, tplId: block.kind === 'library' ? block.tplId : `edited:${block.node.kind}`, matrix: block.kind === 'library' ? block.matrix : [], html: sanitizeHtml(root.innerHTML) };
  state.commit({ ...state.doc, blocks });
  void useStore.getState().refresh();
}

export function styleBlock(index: number, property: string, value: string, text = true) {
  editBlock(index, root => {
    let wrapper = root.content.firstElementChild as HTMLElement | null;
    if (!wrapper || root.content.children.length !== 1) {
      wrapper = document.createElement('section');
      wrapper.append(...root.content.childNodes); root.content.append(wrapper);
    }
    const nodes = text ? [wrapper, ...root.content.querySelectorAll<HTMLElement>('p,span,h1,h2,h3,h4,h5,h6,li,td,th,a,strong,em,u,s,blockquote')] : [wrapper];
    for (const node of nodes) { if (value) node.style.setProperty(property, value); else node.style.removeProperty(property); }
  });
}
