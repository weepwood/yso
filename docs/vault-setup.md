# 在独立 Obsidian Vault 仓库中接入 YSO

推荐将 `weepwood/yso` 保持为公开同步引擎源码仓库，将真实 Obsidian Vault 放在单独的 **Private GitHub Repository** 中。

## 1. Vault 仓库结构

```text
my-vault/
├── .github/workflows/
├── .yso/
├── AI/
├── Math/
├── Daily/
└── yso.config.json
```

`.yso/` 由 YSO 管理，正式开始同步后应该提交到 Git：

- `state.json`：文档 ID / path / base hash 映射；
- `base/`：三方冲突判断的共同基线；
- `conflicts/`：冲突留档。

执行只读 `plan` 时，如果 `.yso/` 原本不存在，YSO 不会创建它。

## 2. 配置文件

在 Vault 仓库根目录创建 `yso.config.json`：

```json
{
  "version": 1,
  "vaultDir": ".",
  "stateDir": ".yso",
  "defaultMode": "bidirectional",
  "writeYuqueMetadata": true,
  "mappings": [
    {
      "localDir": "AI",
      "book": "your-login/ai",
      "mode": "bidirectional",
      "filename": "title"
    },
    {
      "localDir": "Math",
      "book": "your-login/math",
      "mode": "bidirectional",
      "filename": "title"
    }
  ]
}
```

`vaultDir`、`stateDir` 和 `localDir` 都必须是仓库内部的相对路径，YSO 会拒绝 `../`、绝对路径和 Windows 盘符路径。

首次迁移建议先把一个知识库映射到新的隔离目录，并设置 `mode: "pull"`；确认导入结果后再逐步开放双向模式。

## 3. GitHub Secrets

在 Vault 仓库 Settings → Secrets and variables → Actions 中添加：

- `YUQUE_TOKEN`：必需；
- `YUQUE_HOST`：仅企业空间/自定义 Host 需要。

## 4. 工作流

从 YSO 的 `examples/workflows/` 按需要复制：

- `yso-plan.yml`：手动只读预演，不产生任何同步写入；
- `yso-push.yml`：Git push 后将 Obsidian 变化同步到语雀；
- `yso-pull.yml`：接收 `repository_dispatch`，拉取语雀变化；
- `yso-reconcile.yml`：每天全量对账一次，负责补漏。

包装工作流调用：

```yaml
uses: weepwood/yso/.github/workflows/reusable-sync.yml@main
```

正式稳定使用时建议将 `@main` 和 `engine-ref: main` 一起改成同一个版本 tag 或 commit SHA，避免上游变更未经测试直接进入你的 Vault。

## 5. 先运行 Doctor 与 Plan

本地检查：

```bash
npm ci
export YUQUE_TOKEN='...'
npm run doctor
npm run sync -- plan
```

`doctor` 验证配置、Vault、Token 与官方语雀 CLI；`plan` 会读取本地文件列表、已有 state 和语雀文档/删除文档列表，但不会写入任意一端。详细字段见 [`plan.md`](plan.md)。

在 GitHub Actions 中也建议先只开放两个手动 workflow：

```yaml
on:
  workflow_dispatch:
```

确认 `plan` 的 `remote-untracked`、`local-untracked`、`missing-local`、`remote-deleted-tracked` 均符合预期后，再执行真正的 `pull`。

## 6. Webhook

Cloudflare Worker 应把 `repository_dispatch` 发到 **Private Vault 仓库**，不是 `weepwood/yso` 源码仓库。

修改 `worker/wrangler.toml`：

```toml
[vars]
GITHUB_OWNER = "your-github-name"
GITHUB_REPO = "your-private-vault-repo"
```

然后配置：

```bash
cd worker
npm ci
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

`GITHUB_TOKEN` 建议只授权目标 Vault 仓库，并尽量收紧权限。

## 7. 推荐启用顺序

1. `doctor`：只检查环境；
2. `plan`：只读查看同步规模和删除风险；
3. 选择一个隔离目录，手动执行一次 `pull`；
4. 检查生成文件、Frontmatter、`.yso/state.json` 和 `.yso/base/`；
5. 再测试单篇或小范围 `push`；
6. 确认冲突和删除策略符合预期后，再改成 `bidirectional`；
7. 开启语雀 Webhook；
8. 最后加入定时 `reconcile` 作为兜底。

不要一开始就对已有大量笔记同时开放自动 push + pull。首次迁移应先选一个小知识库和隔离目录验证映射。
