import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeConfig(value: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yso-config-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'yso.config.json');
  await fs.writeFile(file, JSON.stringify(value), 'utf8');
  return file;
}

describe('config validation', () => {
  it('accepts repository-root vaultDir', async () => {
    const file = await writeConfig({
      version: 1,
      vaultDir: '.',
      stateDir: '.yso',
      mappings: [{ localDir: 'AI', book: 'user/ai' }],
    });
    const config = await loadConfig(file);
    expect(config.vaultDir).toBe('.');
    expect(config.stateDir).toBe('.yso');
  });

  it.each([
    ['vaultDir', '../vault'],
    ['vaultDir', '/tmp/vault'],
    ['vaultDir', 'C:/vault'],
    ['stateDir', '../state'],
  ])('rejects unsafe %s path', async (field, unsafePath) => {
    const value: Record<string, unknown> = {
      version: 1,
      vaultDir: '.',
      stateDir: '.yso',
      mappings: [{ localDir: 'AI', book: 'user/ai' }],
    };
    value[field] = unsafePath;
    const file = await writeConfig(value);
    await expect(loadConfig(file)).rejects.toThrow('必须是项目内的相对路径');
  });
});
