import fs from 'node:fs/promises';
import path from 'node:path';
import { parseLocalMarkdown, renderAfterPush, renderLocalMarkdown } from './core/markdown.js';
import type { LocalDoc, RemoteDoc, YsoConfig } from './types.js';

export class VaultFs {
  readonly vaultRoot: string;

  constructor(projectRoot: string, private readonly config: YsoConfig) {
    this.vaultRoot = path.resolve(projectRoot, config.vaultDir);
  }

  async scan(): Promise<LocalDoc[]> {
    const docs: LocalDoc[] = [];
    for (const mapping of this.config.mappings) {
      const dir = path.resolve(this.vaultRoot, mapping.localDir);
      for (const absolutePath of await walkMarkdown(dir)) {
        const relativePath = path.relative(this.vaultRoot, absolutePath).replace(/\\/g, '/');
        const raw = await fs.readFile(absolutePath, 'utf8');
        docs.push(parseLocalMarkdown(absolutePath, relativePath, raw));
      }
    }
    return dedupeByPath(docs);
  }

  async read(relativePath: string): Promise<LocalDoc | null> {
    const absolutePath = path.resolve(this.vaultRoot, relativePath);
    if (!inside(this.vaultRoot, absolutePath)) throw new Error(`非法 Vault 路径: ${relativePath}`);
    try {
      const raw = await fs.readFile(absolutePath, 'utf8');
      return parseLocalMarkdown(absolutePath, relativePath.replace(/\\/g, '/'), raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeRemote(relativePath: string, remote: RemoteDoc, book: string): Promise<void> {
    const absolutePath = path.resolve(this.vaultRoot, relativePath);
    if (!inside(this.vaultRoot, absolutePath)) throw new Error(`非法 Vault 路径: ${relativePath}`);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    let currentRaw: string | null = null;
    try { currentRaw = await fs.readFile(absolutePath, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const rendered = renderLocalMarkdown(currentRaw, {
      title: remote.title,
      body: remote.body,
      book,
      slug: remote.slug,
      updatedAt: remote.updated_at,
    }, this.config.writeYuqueMetadata ?? true);
    await fs.writeFile(absolutePath, rendered, 'utf8');
  }

  async updateYuqueMetadata(relativePath: string, remote: RemoteDoc, book: string): Promise<void> {
    if (!(this.config.writeYuqueMetadata ?? true)) return;
    const absolutePath = path.resolve(this.vaultRoot, relativePath);
    const raw = await fs.readFile(absolutePath, 'utf8');
    const rendered = renderAfterPush(raw, {
      title: remote.title,
      book,
      slug: remote.slug,
      updatedAt: remote.updated_at,
    }, true);
    await fs.writeFile(absolutePath, rendered, 'utf8');
  }
}

async function walkMarkdown(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (entry.name === '.obsidian' || entry.name === '.yso' || entry.name === '.git') continue;
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) result.push(...await walkMarkdown(target));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) result.push(target);
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function dedupeByPath(docs: LocalDoc[]): LocalDoc[] {
  return [...new Map(docs.map((doc) => [doc.path, doc])).values()];
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
