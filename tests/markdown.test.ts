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
    expect(output).toContain('tags:');
    expect(output).toContain('title: Remote');
    expect(output).toContain('yuque_link: https://www.yuque.com/a/b/doc');
    expect(output).toContain('remote');
    expect(output).not.toContain('\nlocal\n');
  });

  it('sanitizes filenames', () => {
    expect(sanitizeFilename('A:B/C?')).toBe('A-B-C-');
  });
});
