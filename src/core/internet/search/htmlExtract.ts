/** Small regex-based HTML text extraction for the crawler - no real DOM needed since core/ has
 * zero dependency on the browser. Good enough for the simple, hand-authored pages this
 * simulator's websites are made of. */

export interface ExtractedPage {
  title: string;
  description: string;
  text: string;
  links: string[];
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DESCRIPTION_RE = [
  /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
  /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i,
];

export function extractPage(html: string): ExtractedPage {
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  let description = '';
  for (const re of DESCRIPTION_RE) {
    const m = re.exec(html);
    if (m) {
      description = m[1]!.trim();
      break;
    }
  }
  const links: string[] = [];
  const linkRe = /<a[^>]+href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) links.push(m[1]!);
  return { title: titleMatch?.[1]?.trim() ?? '', description, text: stripTags(html), links };
}

export function parseRobots(content: string): string[] {
  const disallow: string[] = [];
  for (const line of content.split('\n')) {
    const m = /^\s*Disallow:\s*(\S+)/i.exec(line);
    if (m) disallow.push(m[1]!);
  }
  return disallow;
}

export function isDisallowed(path: string, rules: readonly string[]): boolean {
  return rules.some((rule) => rule.length > 0 && path.startsWith(rule));
}

export function parseSitemap(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!.trim());
  return out;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}
