/**
 * Parser for the upstream AngularJS `$templateCache` content packs.
 *
 * The pack is a single JS file made of thousands of calls shaped like:
 *   $templateCache.put('//sd.xiumius.cn/tpls/paper-cp/header/t-a-01-01.html?x=1', '<div ...>')
 * We only need the (url, html) pairs, so a tolerant scanner beats evaluating JS.
 */

export interface PackEntry {
  /** Skeleton URL without query string and without the CDN origin. */
  url: string;
  /** `demo:header/t-a-01` */
  tplId: string;
  html: string;
}

const PUT_CALL =
  /\$templateCache\.put\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3\s*\)/g;

/** Decode a JavaScript single/double quoted string body into plain text. */
export function unescapeJsString(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = input[i + 1];
    if (next === undefined) break;
    switch (next) {
      case 'n':
        out += '\n';
        i++;
        break;
      case 'r':
        out += '\r';
        i++;
        break;
      case 't':
        out += '\t';
        i++;
        break;
      case 'b':
        out += '\b';
        i++;
        break;
      case 'f':
        out += '\f';
        i++;
        break;
      case 'v':
        out += '\v';
        i++;
        break;
      case '0':
        out += '\0';
        i++;
        break;
      case 'x': {
        const hex = input.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 3;
        } else {
          out += next;
          i++;
        }
        break;
      }
      case 'u': {
        if (input[i + 2] === '{') {
          const end = input.indexOf('}', i + 3);
          const hex = end > 0 ? input.slice(i + 3, end) : '';
          if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
            out += String.fromCodePoint(parseInt(hex, 16));
            i = end;
          } else {
            out += next;
            i++;
          }
        } else {
          const hex = input.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 5;
          } else {
            out += next;
            i++;
          }
        }
        break;
      }
      case '\n':
        i++;
        break;
      default:
        out += next;
        i++;
        break;
    }
  }
  return out;
}

/** `//sd.xiumius.cn/tpls/paper-cp/header/t-a-01-01.html?x=1` -> `demo:header/t-a-01` */
export function urlToTplId(url: string): string | null {
  const marker = '/tpls/';
  const index = url.indexOf(marker);
  if (index < 0) return null;
  let rest = url.slice(index + marker.length);
  const query = rest.indexOf('?');
  if (query >= 0) rest = rest.slice(0, query);
  rest = rest.replace(/\.html$/, '');
  const parts = rest.split('/');
  if (parts.length < 2) return null;
  const house = parts[0] ?? '';
  return `${house}:${parts.slice(1).join('/')}`;
}

/** Parse one content pack source file into entries keyed by tplId. */
export function parseTemplatePack(source: string): Map<string, PackEntry> {
  const out = new Map<string, PackEntry>();
  for (const match of source.matchAll(PUT_CALL)) {
    const rawUrl = unescapeJsString(match[2] ?? '');
    const html = unescapeJsString(match[4] ?? '');
    const tplId = urlToTplId(rawUrl);
    if (!tplId) continue;
    if (!out.has(tplId)) out.set(tplId, { url: rawUrl, tplId, html });
  }
  return out;
}

/** Serialize a skeleton map into the JSON shape stored under `data/templates/pack.json`. */
export function packToJson(map: Map<string, PackEntry>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tplId, entry] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[tplId] = entry.html;
  }
  return out;
}

/** Normalize whitespace inside a skeleton's style attributes. */
export function tidySkeleton(html: string): string {
  return html.replace(/style="([^"]*)"/g, (_all, css: string) => {
    const cleaned = css.replace(/\s+/g, ' ').trim();
    return `style="${cleaned}"`;
  });
}
