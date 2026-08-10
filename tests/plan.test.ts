import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMappingPlanSummary, buildOrphanStateSummary, buildPendingDeleteDetails } from '../src/plan.js';
import { StateStore } from '../src/state-store.js';
import type { SyncState, YsoConfig } from '../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('read-only plan', () => {
  it('summarizes tracked and untracked documents without guessing content decisions', () => {
    const state: SyncState = {
      version: 1,
      docs: {
        'weepwood/book:1': { book: 'weepwood/book', docId: 1, slug: 'one', title: 'One', path: 'Pilot/one.md', baseHash: 'a' },
        'weepwood/book:2': { book: 'weepwood/book', docId: 2, slug: 'two', title: 'Two', path: 'Pilot/two.md', baseHash: 'b' },
      },
      pendingDeletes: [{ direction: 'local', key: 'weepwood/book:2', path: 'Pilot/two.md', detectedAt: '2026-08-10T00:00:00Z' }],
    };
    const summary = buildMappingPlanSummary(
      { localDir: 'Pilot', book: 'weepwood/book', mode: 'pull', filename: 'slug' },
      'pull',
      ['Pilot/one.md', 'Pilot/local-only.md'],
      state,
      [
        { id: 1, slug: 'one', title: 'One' },
        { id: 3, slug: 'three', title: 'Three' },
      ],
      [{ id: 2, slug: 'two', title: 'Two', deleted_at: '2026-08-10T00:00:00Z' }],
    );
    expect(summary).toMatchObject({
      localDocuments: 2,
      remoteDocuments: 2,
      trackedDocuments: 1,
      newRemoteDocuments: 1,
      untrackedLocalDocuments: 1,
      missingLocalTrackedDocuments: 1,
      trackedRemoteDeletes: 1,
      pendingDeletes: 1,
    });
  });

  it('expands pending delete metadata from state and deleted remote docs', () => {
    const state: SyncState = {
      version: 1,
      docs: {
        'weepwood/book:2': { book: 'weepwood/book', docId: 2, slug: 'tracked-two', title: 'Tracked Two', path: 'Pilot/two.md', baseHash: 'b' },
      },
      pendingDeletes: [
        { direction: 'local', key: 'weepwood/book:2', path: 'Pilot/two.md', detectedAt: '2026-08-10T00:00:00Z' },
        { direction: 'remote', key: 'weepwood/book:3', detectedAt: '2026-08-10T00:01:00Z' },
      ],
    };

    expect(buildPendingDeleteDetails(
      { localDir: 'Pilot', book: 'weepwood/book', mode: 'pull', filename: 'slug' },
      state,
      [{ id: 3, slug: 'deleted-three', title: 'Deleted Three', deleted_at: '2026-08-10T00:01:00Z' }],
    )).toEqual([
      {
        direction: 'local',
        key: 'weepwood/book:2',
        docId: 2,
        title: 'Tracked Two',
        slug: 'tracked-two',
        path: 'Pilot/two.md',
        detectedAt: '2026-08-10T00:00:00Z',
      },
      {
        direction: 'remote',
        key: 'weepwood/book:3',
        docId: 3,
        title: 'Deleted Three',
        slug: 'deleted-three',
        path: undefined,
        detectedAt: '2026-08-10T00:01:00Z',
      },
    ]);
  });

  it('reports state entries that belong to removed mappings', () => {
    const config: YsoConfig = {
      version: 1,
      vaultDir: '.',
      stateDir: '.yso',
      defaultMode: 'pull',
      writeYuqueMetadata: true,
      mappings: [{ localDir: 'Current', book: 'weepwood/current', mode: 'pull', filename: 'slug' }],
    };
    const state: SyncState = {
      version: 1,
      docs: {
        'weepwood/current:1': { book: 'weepwood/current', docId: 1, slug: 'one', title: 'One', path: 'Current/one.md', baseHash: 'a' },
        'weepwood/removed:2': { book: 'weepwood/removed', docId: 2, slug: 'two', title: 'Two', path: 'Old/two.md', baseHash: 'b' },
      },
      pendingDeletes: [
        { direction: 'remote', key: 'weepwood/current:3', detectedAt: '2026-08-10T00:00:00Z' },
        { direction: 'remote', key: 'weepwood/removed:4', detectedAt: '2026-08-10T00:00:00Z' },
      ],
    };

    expect(buildOrphanStateSummary(config, state)).toEqual({
      trackedDocuments: 1,
      pendingDeletes: 1,
      books: ['weepwood/removed'],
    });
  });

  it('loadReadonly does not create the state directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yso-plan-'));
    tempDirs.push(dir);
    const store = new StateStore(dir, '.yso');
    const state = await store.loadReadonly();
    expect(state.docs).toEqual({});
    await expect(fs.stat(path.join(dir, '.yso'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
