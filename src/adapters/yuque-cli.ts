import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { normalizeMarkdown } from '../core/hash.js';
import type { RemoteDoc, RemoteDocMeta } from '../types.js';

const execFileAsync = promisify(execFile);

export class YuqueCli {
  private readonly bin = process.platform === 'win32' ? 'yuque.cmd' : 'yuque';

  async listDocs(book: string, changedAtGte?: string): Promise<RemoteDocMeta[]> {
    return this.listDocsInternal(book, changedAtGte, false);
  }

  async listDeletedDocs(book: string, changedAtGte?: string): Promise<RemoteDocMeta[]> {
    return this.listDocsInternal(book, changedAtGte, true);
  }

  async getDocById(docId: number): Promise<RemoteDoc> {
    return toRemoteDoc(await this.runJson(['doc', 'get', String(docId)]));
  }

  async getDoc(book: string, ref: string): Promise<RemoteDoc> {
    return toRemoteDoc(await this.runJson(['doc', 'get', book, ref]));
  }

  async createDoc(book: string, title: string, body: string): Promise<RemoteDoc> {
    return this.withBodyFile(body, async (file) => {
      const created = await this.runJson(['doc', 'create', book, '--title', title, '--body-file', file, '--format', 'markdown']);
      const meta = toMeta(created);
      return this.getDocById(meta.id);
    });
  }

  async updateDoc(book: string, docId: number, title: string, body: string): Promise<RemoteDoc> {
    return this.withBodyFile(body, async (file) => {
      await this.runJson(['doc', 'update', book, String(docId), '--title', title, '--body-file', file, '--format', 'markdown']);
      return this.getDocById(docId);
    });
  }

  private async listDocsInternal(book: string, changedAtGte: string | undefined, deleted: boolean): Promise<RemoteDocMeta[]> {
    const args = ['doc', 'list', book, '--all'];
    if (deleted) args.push('--deleted');
    if (changedAtGte) args.push('--changed-at-gte', changedAtGte);
    const result = await this.runJson(args);
    if (!Array.isArray(result)) throw new Error(`语雀 CLI 返回了非数组文档列表: ${book}`);
    return result.map(toMeta);
  }

  private async runJson(args: string[]): Promise<unknown> {
    const env = { ...process.env };
    if (!env.YUQUE_TOKEN?.trim()) throw new Error('缺少 YUQUE_TOKEN 环境变量');
    const { stdout } = await execFileAsync(this.bin, ['--json', ...args], {
      env,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    try {
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`无法解析 yuque-open-cli JSON 输出: ${(error as Error).message}\n${stdout.slice(0, 1000)}`);
    }
  }

  private async withBodyFile<T>(body: string, fn: (file: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yso-'));
    const file = path.join(dir, 'body.md');
    try {
      await fs.writeFile(file, normalizeMarkdown(body), 'utf8');
      return await fn(file);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}

function toMeta(value: unknown): RemoteDocMeta {
  const item = asRecord(value);
  const id = Number(item.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('语雀文档缺少有效 id');
  const slug = stringValue(item.slug);
  const title = stringValue(item.title);
  if (!slug) throw new Error(`语雀文档 ${id} 缺少 slug`);
  return {
    id,
    slug,
    title: title || slug,
    updated_at: stringValue(item.updated_at) || undefined,
    deleted_at: item.deleted_at == null ? null : stringValue(item.deleted_at) || null,
  };
}

function toRemoteDoc(value: unknown): RemoteDoc {
  const item = asRecord(value);
  const meta = toMeta(item);
  const candidates = [item.body, item.body_md, item.body_sheet, item.body_table];
  const body = (candidates.find((candidate) => typeof candidate === 'string' && candidate !== '')
    ?? candidates.find((candidate) => typeof candidate === 'string')) as string | undefined;
  return { ...meta, body: normalizeMarkdown(body ?? '') };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('语雀 CLI 返回了无效对象');
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
