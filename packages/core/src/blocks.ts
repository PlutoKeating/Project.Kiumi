import { mergeStyle, styleToCss } from './style.ts';
import type { NativeNode, StyleMap } from './types.ts';

/**
 * Renderer for content the user authored directly (no upstream template).
 *
 * Every output node must survive WeChat's sanitizer: inline styles only, no
 * classes, no scripts, no external stylesheets.
 */

export interface NativeTheme {
  fontSize: number;
  lineHeight: number;
  color: string;
  letterSpacing: number;
  fontFamily: string;
}

export const DEFAULT_THEME: NativeTheme = {
  fontSize: 16,
  lineHeight: 1.75,
  color: '#3f3f3f',
  letterSpacing: 0.5,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
};

const HEADING_SIZE: Record<number, number> = { 1: 24, 2: 20, 3: 17 };

function baseStyle(node: NativeNode, theme: NativeTheme): StyleMap {
  return {
    margin: '0 0 16px 0',
    fontSize: `${theme.fontSize}px`,
    lineHeight: theme.lineHeight,
    color: theme.color,
    letterSpacing: `${theme.letterSpacing}px`,
    fontFamily: theme.fontFamily,
    ...node.style,
  };
}

function htmlOf(node: NativeNode): string {
  if (node.html) return node.html;
  const text = node.text ?? '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

export function renderNative(node: NativeNode, theme: NativeTheme = DEFAULT_THEME): string {
  switch (node.kind) {
    case 'text':
      return `<p style="${styleToCss(baseStyle(node, theme))}">${htmlOf(node)}</p>`;

    case 'heading': {
      const level = node.level ?? 2;
      const style = baseStyle(
        {
          ...node,
          style: {
            fontWeight: 'bold',
            fontSize: `${HEADING_SIZE[level] ?? 20}px`,
            margin: '24px 0 12px 0',
            ...node.style,
          },
        },
        theme,
      );
      return `<h${level} style="${styleToCss(style)}">${htmlOf(node)}</h${level}>`;
    }

    case 'image': {
      const align = node.align ?? 'center';
      const width = node.width ?? '100%';
      return [
        `<section style="text-align: ${align}; margin: 0 0 16px 0; ${styleToCss(node.style)}">`,
        `<img src="${node.src ?? ''}" style="max-width: ${width}; vertical-align: middle; display: inline-block;">`,
        '</section>',
      ].join('');
    }

    case 'divider': {
      const style = mergeStyle('border-top: 1px solid #e5e5e5; margin: 24px 0;', node.style);
      return `<section style="${style}"></section>`;
    }

    case 'spacer':
      return `<section style="height: ${node.height ?? 16}px; ${styleToCss(node.style)}"></section>`;

    case 'quote': {
      const style = mergeStyle(
        'border-left: 3px solid #d0d0d0; padding: 8px 0 8px 16px; color: #7a7a7a; margin: 0 0 16px 0;',
        baseStyle(node, theme),
      );
      return `<blockquote style="${style}">${htmlOf(node)}</blockquote>`;
    }

    case 'group': {
      const children = (node.children ?? []).map((child) => renderNative(child, theme)).join('');
      if ((node.direction ?? 'vertical') === 'horizontal') {
        return `<section style="display: flex; align-items: flex-start; gap: 8px; margin: 0 0 16px 0; ${styleToCss(node.style)}">${children}</section>`;
      }
      return `<section style="${styleToCss(node.style)}">${children}</section>`;
    }

    default:
      return '';
  }
}
