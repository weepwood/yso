import path from 'node:path';
import { modeFor, resolveMapping } from './config.js';
import { decideSyncAction } from './core/decision.js';
import { hashDocument, hashMarkdown, normalizeMarkdown } from './core/hash.js';
import { extractYuqueLocation, findUnsupportedObsidianSyntax, sanitizeFilename } from './core/markdown.js';
import { VaultFs } from './filesystem.js';
import { StateStore } from './state-store.js';
import type { BookMapping, DocState, LocalDoc, RemoteDoc, SyncState, YsoConfig } from './types.js';
import { YuqueCli } from './adapters/yuque-cli.js';

export class SyncEngine {
  constructor(
    private readonly projectRoot: string,
    private readonly config: YsoConfig,
    private readonly vault: VaultFs,
    private readonly stateStore: StateStore,
    private readonly yuque: YuqueCli,
  ) {}

  static create(projectRoot: string, config: YsoConfig): SyncEngine {
    return new SyncEngine(
      projectRoot,
      config,
      new VaultFs(projectRoot, config),
      new StateStore(projectRoot, config.stateDir ?? '.yso'),
      new YuqueCli(),
    );
  }

  async push(): Promise<void> {
    const state = await this.stateStore.load();
    const locals = await this.vault.scan();
    await this.detectSafeRenames(state, locals);

    for (const local of locals) {
      const mapping = resolveMapping(local.path, this.config);
      if (!mapping || modeFor(mapping, this.config) === 'pull') continue;
      await this.pushOne(state, local, mapping);
    }

    this.detectLocalDeletes(state, new Set(locals.map((doc) => doc.path)));
    await this.stateStore.save(state);
  }

  async pull(options: { full?: boolean } = {}): Promise<void> {
    const state = await this.stateStore.load();
    const scanStartedAt = new Date().toISOString();
    const since = options.full ? undefined : state.lastYuqueScanAt;
    let remoteActivity = false;

    for (const mapping of dedupeMappings(this.config.mappings)) {
      if (modeFor(mapping, this.config) === 'push') continue;

      // The official CLI exposes deleted documents as a separate list query.
      // Record tombstones conservatively; v0.1 never propagates deletion automatically.
      const deletedMetas = await this.yuque.listDeletedDocs(mapping.book, since);
      if (deletedMetas.length > 0) remoteActivity = true;
      for (const meta of deletedMetas) {
        const key = this.stateStore.key(mapping.book, meta.id);
        this.stateStore.addPendingDelete(state, { direction: 'remote', key, path: state.docs[key]?.path });
      }

      const metas = await this.yuque.listDocs(mapping.book, since);
      if (metas.length > 0) remoteActivity = true;
      for (const meta of metas) {
        const remote = await this.yuque.getDocById(meta.id);
        await this.pullOne(state, mapping, remote);
      }
    }

    // Do not move the persisted scan cursor on a completely quiet incremental scan.
    // Otherwise every scheduled pull would dirty state.json and create a meaningless Git commit.
    // Keeping the previous cursor is safe: the next scan may re-check the same quiet window, and
    // any later remote change will still be returned. Full reconcile always advances the cursor.
    if (options.full || !state.lastYuqueScanAt || remoteActivity) {
      state.lastYuqueScanAt = scanStartedAt;
      await this.stateStore.save(state);
    } else {
      console.log(`[pull:noop] 自 ${since} 起未发现语雀变更；保持扫描游标不变，不写入 state.json`);
    }
  }

  async reconcile(): Promise<void> {
    await this.pull({ full: true });
    await this.push();
  }

  private async pushOne(state: SyncState, local: LocalDoc, mapping: BookMapping): Promise<void> {
    const existing = findStateByPath(state, local.path);
    if (!existing) {
      const adopted = await this.tryAdoptFromYuqueLink(state, local, mapping);
      if (adopted) return;

      warnObsidianSyntax(local);
      const created = await this.yuque.createDoc(mapping.book, local.title, local.body);
      const key = this.stateStore.key(mapping.book, created.id);
      const baseHash = hashDocument(created.title, created.body);
      state.docs[key] = toDocState(mapping.book, local.path, created, baseHash);
      await this.stateStore.writeBase(key, created.body);
      await this.vault.updateYuqueMetadata(local.path, created, mapping.book);
      console.log(`[create] ${local.path} -> ${mapping.book}/${created.slug}`);
      return;
    }

    const key = this.stateStore.key(existing.book, existing.docId);
    if (state.pendingDeletes.some((item) => item.direction === 'remote' && item.key === key)) {
      console.warn(`[delete:pending] 语雀端已删除 ${existing.book}/${existing.slug}，跳过本地覆盖`);
      return;
    }
    const remote = await this.yuque.getDocById(existing.docId);
    this.stateStore.clearPendingDelete(state, 'local', key);
    this.stateStore.clearPendingDelete(state, 'remote', key);
    const decision = decideSyncAction(existing.baseHash, hashDocument(local.title, local.body), hashDocument(remote.title, remote.body));
    await this.applyDecision(state, key, existing, local, remote, decision, mapping);
  }

  private async pullOne(state: SyncState, mapping: BookMapping, remote: RemoteDoc): Promise<void> {
    const key = this.stateStore.key(mapping.book, remote.id);
    let existing = state.docs[key];

    if (!existing) {
      const linkedLocal = await this.findLocalByYuqueLink(mapping.book, remote.slug);
      if (linkedLocal) {
        existing = toDocState(mapping.book, linkedLocal.path, remote, hashDocument(remote.title, remote.body));
        const localHash = hashDocument(linkedLocal.title, linkedLocal.body);
        if (localHash !== existing.baseHash) {
          const conflictMeta = { ...existing, baseHash: existing.baseHash };
          const dir = await this.stateStore.writeConflict(key, { base: remote.body, local: linkedLocal.body, remote: remote.body, meta: conflictMeta, titles: { base: remote.title, local: linkedLocal.title, remote: remote.title } });
          state.docs[key] = existing;
          await this.stateStore.writeBase(key, remote.body);
          console.warn(`[conflict:bootstrap] ${linkedLocal.path} -> ${dir}`);
          return;
        }
        state.docs[key] = existing;
        await this.stateStore.writeBase(key, remote.body);
        console.log(`[adopt] ${linkedLocal.path} <-> ${mapping.book}/${remote.slug}`);
        return;
      }

      const exactLocal = await this.findUntrackedLocalByBody(state, mapping, remote.body);
      if (exactLocal) {
        state.docs[key] = toDocState(mapping.book, exactLocal.path, remote, hashDocument(remote.title, remote.body));
        await this.stateStore.writeBase(key, remote.body);
        await this.vault.updateYuqueMetadata(exactLocal.path, remote, mapping.book);
        console.log(`[adopt:hash] ${exactLocal.path} <-> ${mapping.book}/${remote.slug}`);
        return;
      }

      const relativePath = await this.allocateRemotePath(state, mapping, remote);
      await this.vault.writeRemote(relativePath, remote, mapping.book);
      state.docs[key] = toDocState(mapping.book, relativePath, remote, hashDocument(remote.title, remote.body));
      await this.stateStore.writeBase(key, remote.body);
      console.log(`[pull:new] ${mapping.book}/${remote.slug} -> ${relativePath}`);
      return;
    }

    const local = await this.vault.read(existing.path);
    if (!local) {
      this.stateStore.addPendingDelete(state, { direction: 'local', key, path: existing.path });
      console.warn(`[delete:pending] 本地已删除 ${existing.path}，未自动删除/恢复`);
      return;
    }

    this.stateStore.clearPendingDelete(state, 'local', key);
    this.stateStore.clearPendingDelete(state, 'remote', key);
    const decision = decideSyncAction(existing.baseHash, hashDocument(local.title, local.body), hashDocument(remote.title, remote.body));
    await this.applyDecision(state, key, existing, local, remote, decision, mapping);
  }

  private async applyDecision(
    state: SyncState,
    key: string,
    existing: DocState,
    local: LocalDoc,
    remote: RemoteDoc,
    decision: ReturnType<typeof decideSyncAction>,
    mapping: BookMapping,
  ): Promise<void> {
    if (decision === 'noop') return;

    if (decision === 'synced') {
      existing.baseHash = hashDocument(local.title, local.body);
      existing.slug = remote.slug;
      existing.title = remote.title;
      existing.remoteUpdatedAt = remote.updated_at;
      await this.stateStore.writeBase(key, local.body);
      console.log(`[synced] ${local.path}`);
      return;
    }

    if (decision === 'push') {
      if (modeFor(mapping, this.config) === 'pull') return;
      warnObsidianSyntax(local);
      const updated = await this.yuque.updateDoc(existing.book, existing.docId, local.title, local.body);
      existing.baseHash = hashDocument(updated.title, updated.body);
      existing.slug = updated.slug;
      existing.title = updated.title;
      existing.remoteUpdatedAt = updated.updated_at;
      await this.stateStore.writeBase(key, updated.body);
      await this.vault.updateYuqueMetadata(local.path, updated, existing.book);
      console.log(`[push] ${local.path} -> ${existing.book}/${updated.slug}`);
      return;
    }

    if (decision === 'pull') {
      if (modeFor(mapping, this.config) === 'push') return;
      await this.vault.writeRemote(existing.path, remote, existing.book);
      existing.baseHash = hashDocument(remote.title, remote.body);
      existing.slug = remote.slug;
      existing.title = remote.title;
      existing.remoteUpdatedAt = remote.updated_at;
      await this.stateStore.writeBase(key, remote.body);
      console.log(`[pull] ${existing.book}/${remote.slug} -> ${existing.path}`);
      return;
    }

    const base = await this.stateStore.readBase(key) ?? '';
    const dir = await this.stateStore.writeConflict(key, { base, local: local.body, remote: remote.body, meta: existing, titles: { base: existing.title, local: local.title, remote: remote.title } });
    console.warn(`[conflict] ${local.path}; 已保存到 ${path.relative(this.projectRoot, dir)}`);
  }

  private async tryAdoptFromYuqueLink(state: SyncState, local: LocalDoc, mapping: BookMapping): Promise<boolean> {
    const location = extractYuqueLocation(local.yuqueLink);
    if (!location || location.book !== mapping.book) return false;
    const remote = await this.yuque.getDoc(location.book, location.slug);
    const key = this.stateStore.key(location.book, remote.id);
    const remoteHash = hashDocument(remote.title, remote.body);
    const localHash = hashDocument(local.title, local.body);
    const existing = toDocState(location.book, local.path, remote, remoteHash);
    state.docs[key] = existing;
    await this.stateStore.writeBase(key, remote.body);

    if (localHash === remoteHash) {
      await this.vault.updateYuqueMetadata(local.path, remote, location.book);
      console.log(`[adopt:link] ${local.path} <-> ${location.book}/${remote.slug}`);
      return true;
    }

    const dir = await this.stateStore.writeConflict(key, {
      base: remote.body,
      local: local.body,
      remote: remote.body,
      meta: existing,
      titles: { base: remote.title, local: local.title, remote: remote.title },
    });
    console.warn(`[conflict:link] ${local.path} -> ${path.relative(this.projectRoot, dir)}`);
    return true;
  }

  private async findLocalByYuqueLink(book: string, slug: string): Promise<LocalDoc | null> {
    const locals = await this.vault.scan();
    return locals.find((local) => {
      const location = extractYuqueLocation(local.yuqueLink);
      return location?.book === book && location.slug === slug;
    }) ?? null;
  }

  private async findUntrackedLocalByBody(state: SyncState, mapping: BookMapping, body: string): Promise<LocalDoc | null> {
    const locals = await this.vault.scan();
    const trackedPaths = new Set(Object.values(state.docs).map((doc) => doc.path));
    const bodyHash = hashMarkdown(body);
    const candidates = locals.filter((local) => {
      if (trackedPaths.has(local.path)) return false;
      const resolved = resolveMapping(local.path, this.config);
      return resolved?.book === mapping.book && hashMarkdown(local.body) === bodyHash;
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) console.warn(`[bootstrap] 存在 ${candidates.length} 个正文相同的本地候选，放弃自动认领`);
    return null;
  }

  private async allocateRemotePath(state: SyncState, mapping: BookMapping, remote: RemoteDoc): Promise<string> {
    const base = mapping.filename === 'title' ? sanitizeFilename(remote.title) : sanitizeFilename(remote.slug);
    const ext = '.md';
    let candidate = path.posix.join(mapping.localDir, `${base}${ext}`);
    const used = new Set(Object.values(state.docs).map((doc) => doc.path));
    let index = 2;
    while (used.has(candidate) || await this.vault.read(candidate)) {
      candidate = path.posix.join(mapping.localDir, `${base}-${index}${ext}`);
      index += 1;
    }
    return candidate;
  }

  private async detectSafeRenames(state: SyncState, locals: LocalDoc[]): Promise<void> {
    const paths = new Map(locals.map((local) => [local.path, local]));
    const untracked = locals.filter((local) => !findStateByPath(state, local.path));
    const claimed = new Set<string>();

    for (const [key, docState] of Object.entries(state.docs)) {
      if (paths.has(docState.path)) continue;
      const base = await this.stateStore.readBase(key);
      if (base == null) continue;
      const candidates = untracked.filter((local) => !claimed.has(local.path) && hashMarkdown(local.body) === hashMarkdown(base));
      if (candidates.length !== 1) continue;
      const next = candidates[0];
      docState.path = next.path;
      claimed.add(next.path);
      this.stateStore.clearPendingDelete(state, 'local', key);
      console.log(`[rename] ${key} -> ${next.path}`);
    }
  }

  private detectLocalDeletes(state: SyncState, localPaths: Set<string>): void {
    for (const [key, doc] of Object.entries(state.docs)) {
      if (localPaths.has(doc.path)) this.stateStore.clearPendingDelete(state, 'local', key);
      else this.stateStore.addPendingDelete(state, { direction: 'local', key, path: doc.path });
    }
  }
}

function findStateByPath(state: SyncState, relativePath: string): DocState | undefined {
  return Object.values(state.docs).find((doc) => doc.path === relativePath);
}

function toDocState(book: string, localPath: string, remote: RemoteDoc, baseHash: string): DocState {
  return {
    book,
    docId: remote.id,
    slug: remote.slug,
    title: remote.title,
    path: localPath,
    baseHash,
    remoteUpdatedAt: remote.updated_at,
  };
}

function dedupeMappings(mappings: BookMapping[]): BookMapping[] {
  return [...new Map(mappings.map((mapping) => [mapping.book, mapping])).values()];
}

function warnObsidianSyntax(local: LocalDoc): void {
  const unsupported = findUnsupportedObsidianSyntax(local.body);
  for (const item of unsupported) console.warn(`[warn:${item.kind}] ${local.path}: ${item.sample}`);
}
