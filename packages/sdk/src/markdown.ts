import type { NativeNode } from '@kiumi/core';

/**
 * Small, dependency-free Markdown reader for article drafts.
 *
 * Scope is deliberately narrow: headings, paragraphs, lists, quotes, code
 * fences, images, rules and inline emphasis. Anything fancier belongs in a
 * block editor, not in a lossy converter.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code style="background:#f5f5f5;padding:1px 4px;border-radius:3px">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#3f6fe0">$1</a>');
  return out;
}

function imageNode(url: string, alt: string): NativeNode {
  void alt;
  return { kind: 'image', src: url, align: 'center', width: '100%' };
}

export interface MarkdownParseOptions {
  /** Heading level that becomes the document title instead of a block. */
  titleHeading?: 1 | 2;
}

export function markdownToNodes(markdown: string, options: MarkdownParseOptions = {}): {
  title?: string;
  nodes: NativeNode[];
} {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const nodes: NativeNode[] = [];
  let title: string | undefined;
  let index = 0;

  const flushParagraph = (buffer: string[]): void => {
    const text = buffer.join('\n').trim();
    if (!text) return;
    const onlyImage = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(text);
    if (onlyImage) {
      nodes.push(imageNode(onlyImage[2] ?? '', onlyImage[1] ?? ''));
      return;
    }
    nodes.push({ kind: 'text', html: inline(text).replace(/\n/g, '<br>') });
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index++;
      continue;
    }

    // fenced code
    if (trimmed.startsWith('```')) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        body.push(lines[index] ?? '');
        index++;
      }
      index++;
      nodes.push({
        kind: 'text',
        html: `<pre style="background:#f7f7f7;padding:12px;border-radius:6px;overflow-x:auto"><code>${escapeHtml(
          body.join('\n'),
        )}</code></pre>`,
      });
      continue;
    }

    // heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const text = (heading[2] ?? '').trim();
      if (level <= 2 && !title) {
        title = text;
      } else {
        nodes.push({
          kind: 'heading',
          text,
          level: (level >= 3 ? 3 : level) as 1 | 2 | 3,
        });
      }
      index++;
      continue;
    }

    // horizontal rule
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      nodes.push({ kind: 'divider' });
      index++;
      continue;
    }

    // blockquote
    if (trimmed.startsWith('>')) {
      const body: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        body.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index++;
      }
      nodes.push({ kind: 'quote', html: inline(body.join('<br>')) });
      continue;
    }

    // lists
    const bullet = /^([-*+]|\d+\.)\s+/;
    if (bullet.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length && bullet.test((lines[index] ?? '').trim())) {
        items.push((lines[index] ?? '').trim().replace(bullet, ''));
        index++;
      }
      const tag = ordered ? 'ol' : 'ul';
      const list = items
        .map((item) => `<li style="margin:0 0 6px 0">${inline(item)}</li>`)
        .join('');
      nodes.push({
        kind: 'text',
        html: `<${tag} style="padding-left:1.4em;margin:0 0 16px 0">${list}</${tag}>`,
      });
      continue;
    }

    // picture on its own line
    const onlyImage = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (onlyImage) {
      nodes.push(imageNode(onlyImage[2] ?? '', onlyImage[1] ?? ''));
      index++;
      continue;
    }

    // paragraph: consume until blank line or block start
    const buffer: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? '').trim();
      if (!current) break;
      if (/^(#{1,6}\s|>|```|([-*+]|\d+\.)\s)/.test(current)) break;
      if (/^([-*_])\1{2,}$/.test(current)) break;
      buffer.push(current);
      index++;
    }
    flushParagraph(buffer);
  }

  return { title, nodes };
}
