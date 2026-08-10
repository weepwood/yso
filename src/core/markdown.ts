import path from 'node:path';
import matter from 'gray-matter';
import { normalizeMarkdown } from './hash.js';
import type { LocalDoc } from '../types.js';

export interface YuqueLocation {
  book: string;
  slug: string;
}

export function extractYuqueLocation(value: unknown): YuqueLocation | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !['www.yuque.com', 'yuque.com'].includes(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 3) return null;
    return { book: `${parts[0]}/${parts[1]}`, slug: parts[2]! };
  } catch {
    return null;
  }
}

export function parseLocalMarkdown(absolutePath: string, relativePath: string, raw: string): LocalDoc {
  const parsed = matter(raw);
  const titleFromMatter = typeof parsed.data.title === 'string' ? parsed.data.title.trim() : '';
  const fallback = path.basename(relativePath, path.extname(relativePath));
  const yuqueLink = typeof parsed.data.yuque_link === 'string' ? parsed.data.yuque_link : undefined;
  return {
    path: relativePath,
    absolutePath,
    title: titleFromMatter || fallback,
    body: normalizeMarkdown(parsed.content),
    frontmatter: parsed.data as Record<string, unknown>,
    yuqueLink,
  };
}

export function renderLocalMarkdown(
  currentRaw: string | null,
  remote: { title: string; body: string; book: string; slug: string; updatedAt?: string },
  writeYuqueMetadata: boolean,
): string {
  const parsed = currentRaw === null ? { data: {} as Record<string, unknown> } : matter(currentRaw);
  const data = { ...(parsed.data as Record<string, unknown>) };

  // A remote-winning sync must also synchronize the document title.
  data.title = remote.title;
  if (writeYuqueMetadata) {
    data.yuque_link = `https://www.yuque.com/${remote.book}/${remote.slug}`;
    data.yuque_title = remote.title;
    if (remote.updatedAt) data.yuque_updated_at = remote.updatedAt;
  }

  const body = normalizeMarkdown(remote.body);
  if (Object.keys(data).length === 0) return body;
  return matter.stringify(body, data);
}

export function renderAfterPush(
  currentRaw: string,
  remote: { title: string; book: string; slug: string; updatedAt?: string },
  writeYuqueMetadata: boolean,
): string {
  if (!writeYuqueMetadata) return currentRaw;
  const parsed = matter(currentRaw);
  const data = { ...(parsed.data as Record<string, unknown>) };
  data.yuque_link = `https://www.yuque.com/${remote.book}/${remote.slug}`;
  data.yuque_title = remote.title;
  if (remote.updatedAt) data.yuque_updated_at = remote.updatedAt;
  return matter.stringify(parsed.content, data);
}

export function sanitizeFilename(value: string): string {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return normalized || 'untitled';
}

export function findUnsupportedObsidianSyntax(body: string): string[] {
  const warnings: string[] = [];
  if (/!\[\[[^\]]+\]\]/.test(body)) warnings.push('embedded-wikilink');
  if (/(?<!!)\[\[[^\]]+\]\]/.test(body)) warnings.push('wikilink');
  return warnings;
}
