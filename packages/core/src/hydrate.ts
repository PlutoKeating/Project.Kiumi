import { parse } from 'node-html-parser';
import { ATTR, IMAGE_CELL_TYPES, CONTAINER_CELL_TYPES, houseOf, resolveAuxBindings } from './dsl.ts';
import { mergeStyle, styleToCss } from './style.ts';
import type { Cell, Comp, StyleMap, Warning } from './types.ts';

export interface SkeletonMap {
  [tplId: string]: string;
}

export interface HydrateOptions {
  skeletons: SkeletonMap;
  warnings: Warning[];
  /** Emitted as `tn-from-house-<x>` on every component wrapper. */
  defaultHouse?: string;
}

interface CompContext {
  options: HydrateOptions;
  wrapperTag: 'div' | 'li';
  /** When > 0 the comp is a column of a horizontal group. */
  horizontalCount: number;
  depth: number;
}

const ROOT_TAG = 'kiumi-root';
const MAX_DEPTH = 40;

function textOf(cell: Cell): string {
  const raw = (cell.text ?? '').trim();
  if (!raw) return '';
  return raw.includes('<') ? raw : `<p>${escapeHtml(raw)}</p>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function poseStyle(comp: Comp): StyleMap {
  const pose = comp.meta.pose ?? {};
  const out: StyleMap = {};
  if (pose.position) out.position = pose.position;
  if (pose.width) out.width = pose.width;
  if (pose.height) out.height = pose.height;
  return out;
}

/** Render one component: wrapper > section (comp style) > hydrated skeleton. */
export function renderComp(comp: Comp, options: HydrateOptions, ctx?: Partial<CompContext>): string {
  const context: CompContext = {
    options,
    wrapperTag: ctx?.wrapperTag ?? 'div',
    horizontalCount: ctx?.horizontalCount ?? 0,
    depth: ctx?.depth ?? 0,
  };

  const meta = comp.meta;
  const house = houseOf(meta.tplId) || options.defaultHouse || 'paper-cp';
  const skeleton = meta.tplId ? options.skeletons[meta.tplId] : undefined;

  let inner: string;
  if (!skeleton) {
    options.warnings.push({
      code: 'SKELETON_MISSING',
      message: `no skeleton for ${meta.tplId || '<unknown>'}; used generic fallback`,
      tplId: meta.tplId,
    });
    inner = fallbackInner(comp, context);
  } else {
    inner = hydrateSkeleton(skeleton, comp, context);
  }

  const sectionStyle = styleToCss(meta.style);
  const wrapperStyle = styleToCss(poseStyle(comp));
  const horizontalStyle =
    context.horizontalCount > 0
      ? `display: inline-block; vertical-align: top; width: ${(100 / context.horizontalCount).toFixed(4)}%;`
      : '';

  const tag = context.wrapperTag;
  const styleParts = [wrapperStyle, horizontalStyle].filter(Boolean).join(' ').trim();

  return [
    `<${tag} class="tn-comp-anim-pin tn-comp tn-from-house-${house}" style="${styleParts}">`,
    `<section class="tn-comp-pin tn-comp-style-pin" style="${sectionStyle}">`,
    inner,
    '</section>',
    `</${tag}>`,
  ].join('');
}

export function renderComps(comps: Comp[], options: HydrateOptions): string {
  return comps.map((comp) => renderComp(comp, options)).join('\n');
}

function hydrateSkeleton(skeleton: string, comp: Comp, ctx: CompContext): string {
  if (ctx.depth > MAX_DEPTH) {
    ctx.options.warnings.push({
      code: 'DEPTH_EXCEEDED',
      message: `component nesting exceeded ${MAX_DEPTH} levels at ${comp.meta.tplId}`,
      tplId: comp.meta.tplId,
    });
    return '';
  }

  const dom = parse(`<${ROOT_TAG}>${skeleton}</${ROOT_TAG}>`, { lowerCaseTagName: false } as never);
  const root = dom.querySelector(ROOT_TAG);
  if (!root) return skeleton;

  applyDeclarativeStyles(root, comp);

  for (const [slot, cell] of Object.entries(comp.slots)) {
    const nodes = root.querySelectorAll(`[${ATTR.bindCell}="${slot}"]`);
    if (!nodes.length) {
      ctx.options.warnings.push({
        code: 'SLOT_NOT_FOUND',
        message: `slot "${slot}" has no [${ATTR.bindCell}] node in ${comp.meta.tplId}`,
        tplId: comp.meta.tplId,
        slot,
      });
      continue;
    }
    for (const node of nodes) fillCell(node, cell, comp, ctx);
  }

  return root.childNodes.map((node) => node.toString()).join('');
}

type AnyNode = ReturnType<typeof parse>;

function applyDeclarativeStyles(root: AnyNode, comp: Comp): void {
  for (const el of root.querySelectorAll(`[${ATTR.bindAuxProp}]`)) {
    const bindings = resolveAuxBindings(el.getAttribute(ATTR.bindAuxProp), {
      aux: comp.meta.aux,
      meta: comp.meta,
    });
    if (Object.keys(bindings).length) {
      el.setAttribute('style', mergeStyle(el.getAttribute('style'), bindings));
    }
  }
  for (const el of root.querySelectorAll(`[${ATTR.style}]`)) {
    const bindings = resolveAuxBindings(el.getAttribute(ATTR.style), {
      aux: comp.meta.aux,
      meta: comp.meta,
    });
    if (Object.keys(bindings).length) {
      el.setAttribute('style', mergeStyle(el.getAttribute('style'), bindings));
    }
  }
}

function fillCell(node: AnyNode, cell: Cell, comp: Comp, ctx: CompContext): void {
  if (cell.style && Object.keys(cell.style).length) {
    node.setAttribute('style', mergeStyle(node.getAttribute('style'), cell.style));
  }

  if (cell.type === 'text') {
    node.set_content(textOf(cell));
    return;
  }

  if (IMAGE_CELL_TYPES.has(cell.type)) {
    const target = node.tagName?.toLowerCase() === 'img' ? node : node.querySelector('img');
    if (target && cell.src) target.setAttribute('src', cell.src);
    if (target && cell.src && !target.getAttribute('style')) {
      target.setAttribute('style', 'max-width: 100%; vertical-align: middle;');
    }
    if (target && cell.src) return;
    // crop-image slots are styled boxes whose picture is a CSS background.
    if (cell.src && !target) {
      const css = node.getAttribute('style') ?? '';
      node.setAttribute('style', mergeStyle(css, { backgroundImage: `url(${cell.src})` }));
    }
    return;
  }

  if (CONTAINER_CELL_TYPES.has(cell.type)) {
    expandGroup(node, cell, comp, ctx);
  }
}

function expandGroup(node: AnyNode, cell: Cell, comp: Comp, ctx: CompContext): void {
  const items = cell.items ?? [];
  const mounts = node.querySelectorAll(`[${ATTR.subCompLoader}]`);

  const horizontal =
    node.getAttribute(ATTR.childOrientation) === 'horizontal' ||
    Boolean(node.querySelector(`[${ATTR.childOrientation}="horizontal"]`));

  const childCtx = {
    wrapperTag: 'div' as const,
    depth: ctx.depth + 1,
    horizontalCount: horizontal ? items.length : 0,
  };

  if (!mounts.length) {
    if (items.length) {
      node.insertAdjacentHTML(
        'beforeend',
        items.map((item) => renderComp(item, ctx.options, childCtx)).join(''),
      );
    }
    return;
  }

  const [mount, ...extra] = mounts;
  for (const stray of extra) {
    ctx.options.warnings.push({
      code: 'MULTIPLE_MOUNTS',
      message: `slot of ${comp.meta.tplId} declares ${mounts.length} mount points; extras were dropped`,
      tplId: comp.meta.tplId,
    });
    stray.remove();
  }

  const tag = (mount!.tagName ?? 'div').toLowerCase() === 'li' ? 'li' : 'div';
  const html = items
    .map((item) => renderComp(item, ctx.options, { ...childCtx, wrapperTag: tag }))
    .join('');

  if (html) mount!.insertAdjacentHTML('afterend', html);
  mount!.remove();
}

/** Generic rendering used when a skeleton is unavailable. */
function fallbackInner(comp: Comp, ctx: CompContext): string {
  const parts: string[] = [];
  for (const [, cell] of Object.entries(comp.slots)) {
    parts.push(fallbackCell(cell, ctx));
  }
  return parts.join('');
}

function fallbackCell(cell: Cell, ctx: CompContext): string {
  const style = styleToCss(cell.style);
  switch (cell.type) {
    case 'text':
      return `<div ${ATTR.cellType}="text" style="${style}">${textOf(cell)}</div>`;
    case 'image':
      return [
        `<div ${ATTR.cellType}="image" style="text-align: center; ${style}">`,
        `<img src="${cell.src ?? ''}" style="max-width: 100%; vertical-align: middle;">`,
        '</div>',
      ].join('');
    case 'group': {
      const children = (cell.items ?? [])
        .map((item) => renderComp(item, ctx.options, { ...ctx, depth: ctx.depth + 1 }))
        .join('');
      return `<div ${ATTR.cellType}="group" style="${style}">${children}</div>`;
    }
    default:
      return `<div ${ATTR.cellType}="${cell.type}" style="${style}"></div>`;
  }
}
