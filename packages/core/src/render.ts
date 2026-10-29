import { renderNative } from './blocks.ts';
import { renderComps, type SkeletonMap } from './hydrate.ts';
import { normalizeMatrix } from './model.ts';
import type { KiumiDocument, RenderResult, Warning } from './types.ts';

const EMPTY_SKELETONS: SkeletonMap = {};

export interface RenderOptions {
  inlineSvg?: (url: string) => string | undefined;
  /**
   * Recorded HTML for a template. SVG-animation templates are synthesised by
   * the upstream engine, so their matrix cannot reproduce the effect; when the
   * matrix render loses the SVG we fall back to the recorded markup.
   */
  recordedHtml?: (tplId: string) => string | undefined;
}

/** Render one template payload (`matrix`) into WeChat-ready HTML. */
export function renderMatrix(
  matrix: unknown,
  skeletons: SkeletonMap = EMPTY_SKELETONS,
  options: RenderOptions = {},
): RenderResult {
  const warnings: Warning[] = [];
  const comps = normalizeMatrix(matrix);
  if (!comps.length) {
    warnings.push({ code: 'EMPTY_MATRIX', message: 'matrix produced no components' });
  }
  const html = renderComps(comps, { skeletons, warnings, inlineSvg: options.inlineSvg });
  return { html, bytes: Buffer.byteLength(html, 'utf8'), warnings };
}

/** Render a full document: library blocks (hydrated) and native blocks (generated). */
export function renderDocument(
  document: KiumiDocument,
  skeletons: SkeletonMap = EMPTY_SKELETONS,
  options: RenderOptions = {},
): RenderResult {
  const parts: string[] = [];
  const warnings: Warning[] = [];

  for (const block of document.blocks) {
    if (block.kind === 'library') {
      const result = renderMatrix(block.matrix, skeletons, options);
      let html = result.html;
      const recorded = options.recordedHtml?.(block.tplId);
      if (recorded && recorded.includes('<svg') && !html.includes('<svg')) {
        html = recorded;
        warnings.push({
          code: 'SVG_ENGINE_FALLBACK',
          message: `served recorded HTML for ${block.tplId} (SVG is synthesised upstream)`,
        });
      }
      if (html) parts.push(html);
      warnings.push(...result.warnings);
    } else {
      const html = renderNative(block.node);
      if (html) parts.push(html);
    }
  }

  const html = parts.join('\n');
  return { html, bytes: Buffer.byteLength(html, 'utf8'), warnings };
}
