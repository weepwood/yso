import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { extractYuqueLocation, renderLocalMarkdown, sanitizeFilename } from '../src/core/markdown.js';

describe('markdown helpers', () => {
  it('extracts a Yuque book and slug', () => {
    expect(extractYuqueLocation('https://www.yuque.com/weepwood/notes/abc')).toEqual({ book: 'weepwood/notes', slug: 'abc' });
  });

  it('keeps local frontmatter while replacing the body', () => {
    const output = renderLocalMarkdown('---\ntags:\n  - x\n---\nlocal\n', {
      title: 'Remote', body: 'remote\n', book: 'a/b', slug: 'doc', updatedAt: '2026-08-10T00:00:00Z',
    }, true);
    const parsed = matter(output);
    expect(parsed.data.tags).toEqual(['x']);
    expect(parsed.data.title).toBe('Remote');
    expect(parsed.data.yuque_link).toBe('https://www.yuque.com/a/b/doc');
    expect(parsed.data.yuque_title).toBe('Remote');
    expect(parsed.data.yuque_updated_at).toBe('2026-08-10T00:00:00Z');
    expect(parsed.content).toBe('remote\n');
  });

  it('sanitizes filenames', () => {
    expect(sanitizeFilename('A:B/C?')).toBe('A-B-C-');
  });
});
