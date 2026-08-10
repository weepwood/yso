import type { SyncDecision } from '../types.js';

export function decideSyncAction(baseHash: string, localHash: string, remoteHash: string): SyncDecision {
  if (localHash === remoteHash) {
    return localHash === baseHash ? 'noop' : 'synced';
  }

  const localChanged = localHash !== baseHash;
  const remoteChanged = remoteHash !== baseHash;

  if (localChanged && !remoteChanged) return 'push';
  if (!localChanged && remoteChanged) return 'pull';
  if (!localChanged && !remoteChanged) return 'noop';
  return 'conflict';
}
