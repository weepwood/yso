import { modeFor, resolveMapping } from './config.js';
import { YuqueCli } from './adapters/yuque-cli.js';
import { VaultFs } from './filesystem.js';
import { StateStore } from './state-store.js';
import type { BookMapping, RemoteDocMeta, SyncMode, SyncState, YsoConfig } from './types.js';

export interface MappingPlanSummary {
  book: string;
  localDir: string;
  mode: SyncMode;
  localDocuments: number;
  remoteDocuments: number;
  trackedDocuments: number;
  newRemoteDocuments: number;
  untrackedLocalDocuments: number;
  missingLocalTrackedDocuments: number;
  trackedRemoteDeletes: number;
  pendingDeletes: number;
}

export interface OrphanStateSummary {
  trackedDocuments: number;
  pendingDeletes: number;
  books: string[];
}

export async function runPlan(projectRoot: string, config: YsoConfig): Promise<MappingPlanSummary[]> {
  const vault = new VaultFs(projectRoot, config);
  const stateStore = new StateStore(projectRoot, config.stateDir ?? '.yso');
  const yuque = new YuqueCli();
  const state = await stateStore.loadReadonly();
  const locals = await vault.scan();
  const summaries: MappingPlanSummary[] = [];

  console.log('[plan] READ-ONLY：不会写入 Vault、语雀或 .yso/state.json');

  for (const mapping of dedupeMappings(config.mappings)) {
    const mode = modeFor(mapping, config);
    const mappingLocals = locals.filter((local) => resolveMapping(local.path, config)?.book === mapping.book);
    const [remoteDocs, deletedDocs] = await Promise.all([
      yuque.listDocs(mapping.book),
      yuque.listDeletedDocs(mapping.book),
    ]);
    const summary = buildMappingPlanSummary(mapping, mode, mappingLocals.map((local) => local.path), state, remoteDocs, deletedDocs);
    summaries.push(summary);

    console.log(
      `[plan] ${summary.book} mode=${summary.mode} localDir=${summary.localDir} ` +
      `local=${summary.localDocuments} remote=${summary.remoteDocuments} tracked=${summary.trackedDocuments} ` +
      `remote-untracked=${summary.newRemoteDocuments} local-untracked=${summary.untrackedLocalDocuments} ` +
      `missing-local=${summary.missingLocalTrackedDocuments} remote-deleted-tracked=${summary.trackedRemoteDeletes} ` +
      `pending-deletes=${summary.pendingDeletes}`,
    );

    if (summary.mode !== 'push' && summary.newRemoteDocuments > 0) {
      console.log(`[plan:pull] 首次/未跟踪远端文档 ${summary.newRemoteDocuments} 篇；执行 pull 时会进入 ${summary.localDir}`);
    }
    if (summary.mode !== 'pull' && summary.untrackedLocalDocuments > 0) {
      console.log(`[plan:push] 本地未跟踪文档 ${summary.untrackedLocalDocuments} 篇；执行 push 时可能创建或认领语雀文档`);
    }
    if (summary.missingLocalTrackedDocuments > 0 || summary.trackedRemoteDeletes > 0 || summary.pendingDeletes > 0) {
      console.warn(`[plan:risk] ${summary.book} 存在删除/缺失状态，请先检查再执行同步`);
    }
  }

  const orphaned = buildOrphanStateSummary(config, state);
  if (orphaned.trackedDocuments > 0 || orphaned.pendingDeletes > 0) {
    console.warn(
      `[plan:orphan] 配置外残留状态 tracked=${orphaned.trackedDocuments} ` +
      `pending-deletes=${orphaned.pendingDeletes} books=${orphaned.books.join(',') || '-'}；` +
      '这些条目不会参与当前映射，请人工确认后清理',
    );
  }

  return summaries;
}

export function buildMappingPlanSummary(
  mapping: BookMapping,
  mode: SyncMode,
  localPaths: string[],
  state: SyncState,
  remoteDocs: RemoteDocMeta[],
  deletedDocs: RemoteDocMeta[],
): MappingPlanSummary {
  const tracked = Object.entries(state.docs).filter(([, doc]) => doc.book === mapping.book);
  const trackedIds = new Set(tracked.map(([, doc]) => doc.docId));
  const trackedPaths = new Set(tracked.map(([, doc]) => doc.path));
  const localPathSet = new Set(localPaths);
  const remoteIds = new Set(remoteDocs.map((doc) => doc.id));
  const deletedIds = new Set(deletedDocs.map((doc) => doc.id));

  return {
    book: mapping.book,
    localDir: mapping.localDir,
    mode,
    localDocuments: localPaths.length,
    remoteDocuments: remoteDocs.length,
    trackedDocuments: tracked.filter(([, doc]) => remoteIds.has(doc.docId)).length,
    newRemoteDocuments: remoteDocs.filter((doc) => !trackedIds.has(doc.id)).length,
    untrackedLocalDocuments: localPaths.filter((localPath) => !trackedPaths.has(localPath)).length,
    missingLocalTrackedDocuments: tracked.filter(([, doc]) => !localPathSet.has(doc.path)).length,
    trackedRemoteDeletes: tracked.filter(([, doc]) => deletedIds.has(doc.docId)).length,
    pendingDeletes: state.pendingDeletes.filter((item) => item.key.startsWith(`${mapping.book}:`)).length,
  };
}

export function buildOrphanStateSummary(config: YsoConfig, state: SyncState): OrphanStateSummary {
  const activeBooks = new Set(config.mappings.map((mapping) => mapping.book));
  const orphanDocs = Object.values(state.docs).filter((doc) => !activeBooks.has(doc.book));
  const orphanPending = state.pendingDeletes.filter(
    (item) => ![...activeBooks].some((book) => item.key.startsWith(`${book}:`)),
  );
  const books = new Set<string>(orphanDocs.map((doc) => doc.book));

  for (const item of orphanPending) {
    const separator = item.key.lastIndexOf(':');
    if (separator > 0) books.add(item.key.slice(0, separator));
  }

  return {
    trackedDocuments: orphanDocs.length,
    pendingDeletes: orphanPending.length,
    books: [...books].sort(),
  };
}

function dedupeMappings(mappings: BookMapping[]): BookMapping[] {
  return [...new Map(mappings.map((mapping) => [mapping.book, mapping])).values()];
}
