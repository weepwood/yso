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
  const bin = process.platform === 'win32' ? 'yuque.cmd' : 'yuque';

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

  const hasToken = Boolean(process.env.YUQUE_TOKEN?.trim());
  if (!hasToken) errors.push('缺少 YUQUE_TOKEN 环境变量');

  let cliAvailable = false;
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { env: process.env, windowsHide: true });
    cliAvailable = true;
    console.log(`[doctor] yuque-open-cli ${stdout.trim()}`);
  } catch (error) {
    errors.push(`无法执行 yuque-open-cli: ${error instanceof Error ? error.message : String(error)}`);
  }

  const skipRemote = process.env.YSO_DOCTOR_SKIP_REMOTE === '1';
  if (skipRemote) {
    warnings.push('已跳过语雀远端知识库访问检查（YSO_DOCTOR_SKIP_REMOTE=1）');
  } else if (hasToken && cliAvailable) {
    const books = [...new Set(config.mappings.map((mapping) => mapping.book))];
    for (const book of books) {
      try {
        const { stdout } = await execFileAsync(bin, ['--json', 'book', 'get', book], {
          env: process.env,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        });
        const parsed = JSON.parse(stdout) as { namespace?: unknown; name?: unknown };
        const namespace = typeof parsed.namespace === 'string' ? parsed.namespace : book;
        const name = typeof parsed.name === 'string' ? parsed.name : '';
        console.log(`[doctor:remote] OK ${namespace}${name ? ` (${name})` : ''}`);
      } catch (error) {
        errors.push(`无法访问语雀知识库 ${book}: ${commandErrorMessage(error)}`);
      }
    }
  }

  console.log(`[doctor] projectRoot=${projectRoot}`);
  console.log(`[doctor] vaultDir=${config.vaultDir}`);
  console.log(`[doctor] mappings=${config.mappings.length}`);
  for (const warning of warnings) console.warn(`[doctor:warn] ${warning}`);
  if (errors.length > 0) throw new Error(`YSO 环境检查失败:\n- ${errors.join('\n- ')}`);
  console.log('[doctor] OK');
}

function commandErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const maybe = error as Error & { stderr?: string };
  const stderr = typeof maybe.stderr === 'string' ? maybe.stderr.trim() : '';
  return stderr || error.message;
}
