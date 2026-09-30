/**
 * Heuristics for telling a real URL apart from dotted tokens that merely look
 * like one ("Node.js", "B.Tech", "8.9/10"). Both the contact/link extractor and
 * the project parser need this, so it lives in one place.
 */

export const URL_TOKEN_RE =
  /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/[^\s)]*)?/g;

/** TLDs that are far more often a file/code extension than a website. */
const CODE_TLDS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'tsx', 'ts', 'py', 'rb', 'java', 'go', 'md', 'json', 'css',
  'scss', 'html', 'htm', 'yml', 'yaml', 'sh', 'bash', 'zsh', 'c', 'h', 'cpp', 'hpp', 'cs',
  'rs', 'php', 'sql', 'txt', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'png',
  'jpg', 'jpeg', 'gif', 'svg', 'webp', 'env', 'toml', 'ini', 'cfg', 'conf', 'lock', 'log',
  'db', 'sqlite', 'ipynb', 'vue', 'svelte', 'swift', 'kt', 'scala', 'pl', 'r', 'm', 'exe',
  'dll', 'so', 'jar', 'class', 'gradle', 'properties', 'dist', 'min', 'map', 'lock',
]);

/** TLDs that are unambiguously website-ish. */
const COMMON_TLDS = new Set([
  'com', 'org', 'net', 'io', 'dev', 'ai', 'co', 'me', 'app', 'xyz', 'info', 'tv', 'to',
  'in', 'us', 'uk', 'de', 'ca', 'au', 'nl', 'fr', 'jp', 'edu', 'gov', 'tech', 'design',
  'fm', 'gg', 'ly', 'gl', 'is', 'eu', 'cn', 'br', 'mx', 'se', 'no', 'ch', 'it', 'es',
  'ru', 'kr', 'za', 'nz', 'ie', 'sg', 'hk', 'tw', 'pl', 'be', 'at', 'dk', 'fi', 'pt',
  'gr', 'cz', 'ro', 'tr', 'il', 'ae', 'sa', 'pk', 'ng', 'ph', 'id', 'vn', 'th', 'my',
  'ar', 'cl', 'ws', 'site', 'online', 'store', 'blog', 'cloud', 'page', 'space', 'fun',
  'life', 'world', 'group', 'club', 'news', 'shop', 'pro', 'biz', 'academy', 'agency',
  'studio', 'systems', 'network', 'digital', 'media', 'solutions', 'works', 'careers',
  'company', 'engineering', 'technology', 'finance', 'guide', 'team', 'wiki',
]);

function stripTrailingPunctuation(token: string): string {
  return token.replace(/[.,;:!?)\]}'"…]+$/, '');
}

/**
 * True when a token is plausibly a website address rather than code or prose.
 * A scheme always wins; scheme-less candidates must use a lowercase domain and
 * a TLD that is either known-good or at least three characters long.
 */
export function isLikelyUrl(raw: string): boolean {
  const token = stripTrailingPunctuation(raw.trim());
  if (token.length < 5) return false;

  const hasScheme = /^https?:\/\//i.test(token);
  const host = token
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0];
  if (!host.includes('.')) return false;

  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return false;

  const tld = labels[labels.length - 1].toLowerCase();
  const domain = labels.slice(0, -1).join('.');

  if (CODE_TLDS.has(tld)) return false;
  if (!hasScheme && /[A-Z]/.test(domain)) return false;
  if (COMMON_TLDS.has(tld)) return true;
  return tld.length >= 3;
}

/** Returns the first likely URL inside a line, or undefined. */
export function findUrl(line: string): string | undefined {
  for (const match of line.matchAll(URL_TOKEN_RE)) {
    if (isLikelyUrl(match[0])) return match[0];
  }
  return undefined;
}

export function toAbsoluteUrl(url: string): string {
  const clean = stripTrailingPunctuation(url.trim());
  return clean.startsWith('http') ? clean : `https://${clean}`;
}
