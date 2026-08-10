import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { YsoConfig } from './types.js';

const execFileAsync = promisify(execFile);

export async function runDoctor(projectRoot: string, config: YsoConfig): Promise<void> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const vaultRoot = path.resolve(projectRoot, config.vaultDir);

  try {
    const stat = await fs.stat(vaultRoot);
    if (!stat.isDirectory()) errors.push(`vaultDir 不是目录: ${config.vaultDir}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') errors.push(`vaultDir 不存在: ${config.vaultDir}`);
    else throw error;
  }

  for (const mapping of config.mappings) {
    const target = path.resolve(vaultRoot, mapping.localDir);
    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) errors.push(`mapping.localDir 不是目录: ${mapping.localDir}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        warnings.push(`mapping.localDir 尚不存在，pull 时可自动创建: ${mapping.localDir}`);
      } else {
        throw error;
      }
    }
  }

  if (!process.env.YUQUE_TOKEN?.trim()) errors.push('缺少 YUQUE_TOKEN 环境变量');

  try {
    const bin = process.platform === 'win32' ? 'yuque.cmd' : 'yuque';
    const { stdout } = await execFileAsync(bin, ['--version'], { env: process.env, windowsHide: true });
    console.log(`[doctor] yuque-open-cli ${stdout.trim()}`);
  } catch (error) {
    errors.push(`无法执行 yuque-open-cli: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`[doctor] projectRoot=${projectRoot}`);
  console.log(`[doctor] vaultDir=${config.vaultDir}`);
  console.log(`[doctor] mappings=${config.mappings.length}`);
  for (const warning of warnings) console.warn(`[doctor:warn] ${warning}`);
  if (errors.length > 0) throw new Error(`YSO 环境检查失败:\n- ${errors.join('\n- ')}`);
  console.log('[doctor] OK');
}
