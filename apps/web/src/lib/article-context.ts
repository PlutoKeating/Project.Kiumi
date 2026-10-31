/**
 * The one reading context for article HTML: canvas, thumbnails and preview must agree,
 * because templates are authored for border-box layout with zero paragraph margins.
 * `styles.css` mirrors these rules under `[data-block-content]`.
 */
export const ARTICLE_CSS = "*{box-sizing:border-box}html,body{margin:0;font:16px/1.6 -apple-system,'PingFang SC',sans-serif;color:#3f3f3f;background:white}img,svg{max-width:100%;height:auto}section,div,p{max-width:100%}p{margin:0}";
