export type {
  Block,
  Cell,
  CellType,
  Comp,
  CompAux,
  CompConstraint,
  CompMeta,
  CompPose,
  Issue,
  IssueLevel,
  KiumiDocument,
  LibraryBlock,
  NativeBlock,
  NativeNode,
  RenderResult,
  RoomInfo,
  StyleMap,
  StyleValue,
  TemplateIndexEntry,
  TemplateRecord,
  ShopProvenance,
  Warning,
} from './types.ts';

export { ATTR, houseOf, tplIdToPath, parseAuxBindings, resolveAuxBindings, evalAuxExpr, isEmptyComp } from './dsl.ts';
export { kebabCase, utf8Bytes, styleToCss, mergeStyle, parseCss, getCss, hasZeroHeight, normalizeCss } from './style.ts';
export {
  normalizeComp,
  normalizeMatrix,
  collectTplIds,
  walkComps,
  primarySlot,
  setSlotValue,
} from './model.ts';
export {
  parseTemplatePack,
  packToJson,
  unescapeJsString,
  urlToTplId,
  tidySkeleton,
  type PackEntry,
} from './pack.ts';
export {
  renderComp,
  renderComps,
  type HydrateOptions,
  type SkeletonMap,
} from './hydrate.ts';
export { renderNative, DEFAULT_THEME, type NativeTheme } from './blocks.ts';
export { validateHtml, summarizeIssues, type ValidateOptions } from './validate.ts';
export { renderMatrix, renderDocument } from './render.ts';
export { fillMatrix } from './fill.ts';
export { sanitizeHtml, patchRecordedHtml, rewriteHtmlAssets, placateTemplateText } from './html.ts';
export {
  CONFIDENT,
  classifyFacts,
  annotationRequest,
  applyAnnotations,
  assembleManuscript,
  manuscriptImages,
  outlineOf,
  numberingKind,
  splitTrailingByline,
  parseByline,
  escapeHtml,
  type ParaRole,
  type SourceFact,
  type Classified,
  type Part,
  type Section,
  type Byline,
  type Manuscript,
} from './manuscript.ts';
export {
  THUMB,
  fingerprint,
  hamming,
  similarity,
  matchImages,
  unusedOriginals,
  resizeGray,
  type Fingerprint,
  type ImageMatch,
  type MatchOptions,
  type Candidate,
} from './imagematch.ts';
export {
  DEFAULT_RULES,
  normalizeRules,
  formatArticleTitle,
  paragraphCss,
  wrapperCss,
  imageCss,
  blankLineHtml,
  lintBlocks,
  type TypesetRules,
  type LintIssue,
  type LintBlock,
  type StyleRole,
} from './typeset.ts';
export {
  analyzeTemplate,
  fillTemplate,
  plainArticle,
  manuscriptItems,
  isPhotoSrc,
  manuscriptPieces,
  autoPlan,
  planPrompt,
  parsePlan,
  executePlan,
  type Piece,
  type PieceKind,
  type PlanEntry,
  type PlanSource,
  type ZoneInfo,
  type TemplateSchema,
  type UnitInfo,
  type UnitKind,
  type FillOptions,
  type FillReport,
} from './templatefill.ts';
export { parseDocx, type DocxParts, type DocxFacts } from './docxfacts.ts';
export { applyOps, validateOps, type DocOp, type OpResult } from './docops.ts';
