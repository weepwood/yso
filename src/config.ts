import fs from 'node:fs/promises';
import path from 'node:path';
import type { BookMapping, SyncMode, YsoConfig } from './types.js';

const MODES = new Set<SyncMode>(['bidirectional', 'push', 'pull']);

export async function loadConfig(configPath: string): Promise<YsoConfig> {
  const absolute = path.resolve(configPath);
  const raw = await fs.readFile(absolute, 'utf8');
  const config = JSON.parse(raw) as Partial<YsoConfig>;

  if (config.version !== 1) throw new Error('yso.config.json: version 必须为 1');
  if (!config.vaultDir || typeof config.vaultDir !== 'string') throw new Error('yso.config.json: 缺少 vaultDir');
  if (!Array.isArray(config.mappings) || config.mappings.length === 0) throw new Error('yso.config.json: mappings 至少需要一项');

  for (const mapping of config.mappings) validateMapping(mapping);
  const books = new Set<string>();
  const localDirs = new Set<string>();
  for (const mapping of config.mappings) {
    if (books.has(mapping.book)) throw new Error(`同一个语雀知识库只能映射到一个 localDir: ${mapping.book}`);
    books.add(mapping.book);
    const localDir = mapping.localDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') || '.';
    if (localDirs.has(localDir)) throw new Error(`同一个 localDir 只能映射到一个语雀知识库: ${mapping.localDir}`);
    localDirs.add(localDir);
  }
  if (config.defaultMode && !MODES.has(config.defaultMode)) throw new Error(`不支持 defaultMode: ${config.defaultMode}`);

  return {
    version: 1,
    vaultDir: config.vaultDir,
    stateDir: config.stateDir ?? '.yso',
    defaultMode: config.defaultMode ?? 'bidirectional',
    writeYuqueMetadata: config.writeYuqueMetadata ?? true,
    mappings: config.mappings,
  };
}

function validateMapping(mapping: BookMapping): void {
  if (!mapping.localDir || !mapping.book) throw new Error('每个 mapping 都需要 localDir 与 book');
  const localDir = mapping.localDir.replace(/\\/g, '/');
  if (localDir.startsWith('/') || /^[A-Za-z]:\//.test(localDir) || localDir.split('/').includes('..')) {
    throw new Error(`localDir 必须是 Vault 内的相对路径: ${mapping.localDir}`);
  }
  if (!/^[^/]+\/[^/]+$/.test(mapping.book)) throw new Error(`语雀知识库应为 namespace/book: ${mapping.book}`);
  if (mapping.mode && !MODES.has(mapping.mode)) throw new Error(`不支持同步模式: ${mapping.mode}`);
  if (mapping.filename && !['title', 'slug'].includes(mapping.filename)) throw new Error(`不支持 filename: ${mapping.filename}`);
}

export function resolveMapping(relativePath: string, config: YsoConfig): BookMapping | null {
  const posixPath = relativePath.replace(/\\/g, '/');
  const sorted = [...config.mappings].sort((a, b) => mappingSpecificity(b.localDir) - mappingSpecificity(a.localDir));
  return sorted.find((mapping) => {
    const dir = mapping.localDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (dir === '.' || dir === '') return true;
    return posixPath === `${dir}.md` || posixPath.startsWith(`${dir}/`);
  }) ?? null;
}

export function modeFor(mapping: BookMapping, config: YsoConfig): SyncMode {
  return mapping.mode ?? config.defaultMode ?? 'bidirectional';
}

function mappingSpecificity(localDir: string): number {
  const dir = localDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return dir === '.' || dir === '' ? -1 : dir.length;
}
