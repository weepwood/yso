export type SyncMode = 'bidirectional' | 'push' | 'pull';
export type FilenameStrategy = 'title' | 'slug';

export interface BookMapping {
  localDir: string;
  book: string;
  mode?: SyncMode;
  filename?: FilenameStrategy;
}

export interface YsoConfig {
  version: 1;
  vaultDir: string;
  stateDir?: string;
  defaultMode?: SyncMode;
  writeYuqueMetadata?: boolean;
  mappings: BookMapping[];
}

export interface DocState {
  book: string;
  docId: number;
  slug: string;
  title: string;
  path: string;
  baseHash: string;
  remoteUpdatedAt?: string;
}

export interface SyncState {
  version: 1;
  lastYuqueScanAt?: string;
  docs: Record<string, DocState>;
  pendingDeletes: PendingDelete[];
}

export interface PendingDelete {
  direction: 'local' | 'remote';
  key: string;
  path?: string;
  detectedAt: string;
}

export interface RemoteDocMeta {
  id: number;
  slug: string;
  title: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface RemoteDoc extends RemoteDocMeta {
  body: string;
}

export interface LocalDoc {
  path: string;
  absolutePath: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  yuqueLink?: string;
}

export type SyncDecision = 'noop' | 'push' | 'pull' | 'synced' | 'conflict';
