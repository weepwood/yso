#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { SyncEngine } from './sync-engine.js';

const program = new Command();
program
  .name('yso')
  .description('Yuque ↔ Git/Obsidian 双向同步引擎')
  .option('-c, --config <path>', '配置文件路径', 'yso.config.json');

for (const command of ['push', 'pull', 'reconcile'] as const) {
  program.command(command).description(description(command)).action(async () => {
    const opts = program.opts<{ config: string }>();
    const projectRoot = process.cwd();
    const config = await loadConfig(path.resolve(projectRoot, opts.config));
    const engine = SyncEngine.create(projectRoot, config);
    if (command === 'push') await engine.push();
    else if (command === 'pull') await engine.pull();
    else await engine.reconcile();
  });
}

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

function description(command: 'push' | 'pull' | 'reconcile'): string {
  if (command === 'push') return '扫描本地 Vault，并安全推送变更到语雀';
  if (command === 'pull') return '增量拉取语雀变更到本地 Vault';
  return '全量对账后再扫描本地变更';
}
