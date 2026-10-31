import type { Block } from '../api.ts';
import { plainText, listSlots } from './slots.ts';

export function blockKind(block: Block): string {
  if (block.kind === 'library') return '模板';
  const names: Record<string, string> = { heading: '标题', text: '正文', quote: '引用', image: '图片', divider: '分割线', spacer: '留白', list: '列表' };
  return names[block.node.kind] ?? '内容';
}

export function blockSummary(block: Block): string {
  const source = block.kind === 'library'
    ? block.html ?? listSlots(block.matrix).filter(slot => slot.prop === 'text').map(slot => slot.value).join(' ')
    : block.node.html ?? block.node.text;
  const text = source ? plainText(source).replace(/\s+/g, ' ').trim() : '';
  if (text) return text.slice(0, 100);
  return block.kind === 'library' ? '图文模板' : blockKind(block);
}
