import { parse } from 'node-html-parser';
import { ATTR } from './dsl.ts';
import { hasZeroHeight, utf8Bytes } from './style.ts';
import type { Issue } from './types.ts';

export interface ValidateOptions {
  /** WeChat article body budget in UTF-8 bytes. */
  maxBytes?: number;
  /** Report class-only styling. Noisy on upstream templates, off by default. */
  reportStylelessClass?: boolean;
}

const FORBIDDEN_TAGS = new Set([
  'script',
  'style',
  'link',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'textarea',
  'select',
  'button',
]);

const SAFE_SRC = /^(https?:)?\/\//i;

type AnyNode = ReturnType<typeof parse>;

function describe(node: AnyNode): string {
  const tag = (node.tagName ?? 'node').toLowerCase();
  const id = node.getAttribute?.('id');
  const bind = node.getAttribute?.(ATTR.bindCell);
  const cls = node.getAttribute?.('class');
  const bits = [tag];
  if (id) bits.push(`#${id}`);
  if (bind) bits.push(`[${bind}]`);
  if (cls) bits.push(`.${cls.split(/\s+/)[0]}`);
  return bits.join('');
}

/**
 * WeChat allows `height:0` inside an SVG interaction container to build the
 * click-to-expand trick, so any element that contains or sits inside an SVG
 * subtree is exempt.
 */
function insideSvg(node: AnyNode): boolean {
  if ((node.tagName ?? '').toLowerCase() === 'svg') return true;
  if (node.querySelector?.('svg')) return true;
  let current: AnyNode | null = node.parentNode as AnyNode | null;
  while (current) {
    if ((current.tagName ?? '').toLowerCase() === 'svg') return true;
    if (current.querySelector?.('svg')) return true;
    current = current.parentNode as AnyNode | null;
  }
  return false;
}

/**
 * Static WeChat compatibility check. Runs on the rendered HTML, never on the
 * source model, so it also catches bugs introduced by the renderer itself.
 */
export function validateHtml(html: string, options: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const maxBytes = options.maxBytes ?? 20_000;
  const dom = parse(html, { lowerCaseTagName: true, comment: false } as never);
  const all = dom.querySelectorAll('*');

  let stylelessClassCount = 0;

  for (const node of all) {
    const tag = (node.tagName ?? '').toLowerCase();
    const selector = describe(node);

    if (FORBIDDEN_TAGS.has(tag)) {
      issues.push({
        rule: 'forbidden-tag',
        level: 'error',
        message: `<${tag}> is stripped by WeChat and breaks the article`,
        selector,
      });
    }

    for (const attr of Object.keys(node.attributes ?? {})) {
      if (/^on[a-z]+$/i.test(attr)) {
        issues.push({
          rule: 'event-attribute',
          level: 'error',
          message: `event handler "${attr}" is not allowed`,
          selector,
        });
      }
    }

    const style = node.getAttribute('style');

    if (hasZeroHeight(style) && !insideSvg(node)) {
      issues.push({
        rule: 'zero-height',
        level: 'warn',
        message: 'height:0 outside an SVG container: allowed only for decorative shapes',
        selector,
      });
    }

    if (tag === 'img') {
      const src = node.getAttribute('src') ?? '';
      if (src && !SAFE_SRC.test(src) && !src.startsWith('data:')) {
        issues.push({
          rule: 'relative-image',
          level: 'error',
          message: `image src must be absolute, got "${src.slice(0, 60)}"`,
          selector,
        });
      }
      if (!src) {
        issues.push({
          rule: 'empty-image',
          level: 'warn',
          message: 'image without src renders as a broken box',
          selector,
        });
      }
    }

    if (node.hasAttribute(ATTR.subCompLoader)) {
      issues.push({
        rule: 'unfilled-mount',
        level: 'error',
        message: 'a nested drop zone was never expanded',
        selector,
      });
    }

    if (node.getAttribute('class') && !style) stylelessClassCount++;
  }

  const bytes = utf8Bytes(html);
  if (bytes > maxBytes) {
    issues.push({
      rule: 'byte-budget',
      level: 'warn',
      message: `body is ${bytes} bytes, above the ${maxBytes} budget`,
      detail: { bytes, maxBytes },
    });
  }

  if (options.reportStylelessClass && stylelessClassCount > 0) {
    issues.push({
      rule: 'styleless-class',
      level: 'info',
      message: `${stylelessClassCount} elements carry a class but no inline style`,
      detail: { count: stylelessClassCount },
    });
  }

  return issues;
}

export function summarizeIssues(issues: Issue[]): {
  errors: number;
  warnings: number;
  infos: number;
} {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const issue of issues) {
    if (issue.level === 'error') errors++;
    else if (issue.level === 'warn') warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}
