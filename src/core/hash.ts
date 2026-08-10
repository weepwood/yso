import { createHash } from 'node:crypto';

export function normalizeMarkdown(input: string): string {
  const withoutBom = input.replace(/^\uFEFF/, '');
  const lf = withoutBom.replace(/\r\n?/g, '\n');
  return lf.replace(/[\t ]+$/gm, '').replace(/\n*$/, '\n');
}

export function hashMarkdown(input: string): string {
  return createHash('sha256').update(normalizeMarkdown(input), 'utf8').digest('hex');
}

export function hashDocument(title: string, body: string): string {
  return createHash('sha256')
    .update(`${title.trim()}\n\0\n${normalizeMarkdown(body)}`, 'utf8')
    .digest('hex');
}
