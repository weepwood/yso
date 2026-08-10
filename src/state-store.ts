import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DocState, PendingDelete, SyncState } from './types.js';

export class StateStore {
  readonly root: string;
  readonly statePath: string;
  readonly baseDir: string;
  readonly conflictDir: string;

  constructor(projectRoot: string, stateDir: string) {
    this.root = path.resolve(projectRoot, stateDir);
    this.statePath = path.join(this.root, 'state.json');
    this.baseDir = path.join(this.root, 'base');
    this.conflictDir = path.join(this.root, 'conflicts');
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(this.conflictDir, { recursive: true });
  }

  async load(): Promise<SyncState> {
    await this.ensure();
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as SyncState;
      return { version: 1, docs: parsed.docs ?? {}, pendingDeletes: parsed.pendingDeletes ?? [], lastYuqueScanAt: parsed.lastYuqueScanAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, docs: {}, pendingDeletes: [] };
      throw error;
    }
  }

  async save(state: SyncState): Promise<void> {
    await this.ensure();
    const ordered: SyncState = {
      version: 1,
      lastYuqueScanAt: state.lastYuqueScanAt,
      docs: Object.fromEntries(Object.entries(state.docs).sort(([a], [b]) => a.localeCompare(b))),
      pendingDeletes: state.pendingDeletes,
    };
    await fs.writeFile(this.statePath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  }

  key(book: string, docId: number): string {
    return `${book}:${docId}`;
  }

  async readBase(key: string): Promise<string | null> {
    try {
      return await fs.readFile(this.basePath(key), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeBase(key: string, body: string): Promise<void> {
    await this.ensure();
    await fs.writeFile(this.basePath(key), body, 'utf8');
  }

  async writeConflict(key: string, values: { base: string; local: string; remote: string; meta: DocState; titles?: { base: string; local: string; remote: string } }): Promise<string> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ base: values.base, local: values.local, remote: values.remote, titles: values.titles }), 'utf8')
      .digest('hex')
      .slice(0, 16);
    const dir = path.join(this.conflictDir, safeKey(key), fingerprint);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(dir, 'base.md'), values.base, 'utf8'),
      fs.writeFile(path.join(dir, 'local.md'), values.local, 'utf8'),
      fs.writeFile(path.join(dir, 'yuque.md'), values.remote, 'utf8'),
      fs.writeFile(path.join(dir, 'meta.json'), `${JSON.stringify({ state: values.meta, titles: values.titles }, null, 2)}\n`, 'utf8'),
    ]);
    return dir;
  }

  addPendingDelete(state: SyncState, entry: Omit<PendingDelete, 'detectedAt'>): void {
    if (state.pendingDeletes.some((item) => item.direction === entry.direction && item.key === entry.key)) return;
    state.pendingDeletes.push({ ...entry, detectedAt: new Date().toISOString() });
  }

  clearPendingDelete(state: SyncState, direction: PendingDelete['direction'], key: string): void {
    state.pendingDeletes = state.pendingDeletes.filter((item) => !(item.direction === direction && item.key === key));
  }

  private basePath(key: string): string {
    return path.join(this.baseDir, `${safeKey(key)}.md`);
  }
}

function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
