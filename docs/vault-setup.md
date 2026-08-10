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

`.yso/` 由 YSO 管理，应该提交到 Git：

- `state.json`：文档 ID / path / base hash 映射；
- `base/`：三方冲突判断的共同基线；
- `conflicts/`：冲突留档。

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

## 3. GitHub Secrets

在 Vault 仓库 Settings → Secrets and variables → Actions 中添加：

- `YUQUE_TOKEN`：必需；
- `YUQUE_HOST`：仅企业空间/自定义 Host 需要。

## 4. 三个工作流

从 YSO 的 `examples/workflows/` 复制：

- `yso-push.yml`：Git push 后将 Obsidian 变化同步到语雀；
- `yso-pull.yml`：接收 `repository_dispatch`，拉取语雀变化；
- `yso-reconcile.yml`：每天全量对账一次，负责补漏。

三个包装工作流都调用：

```yaml
uses: weepwood/yso/.github/workflows/reusable-sync.yml@main
```

正式稳定使用时建议将 `@main` 和 `engine-ref: main` 一起改成同一个版本 tag 或 commit SHA，避免上游变更未经测试直接进入你的 Vault。

## 5. 本地检查

如果本地 clone 了 YSO：

```bash
npm install
export YUQUE_TOKEN='...'
npm run doctor -- --config /path/to/vault/yso.config.json
```

在 Vault 仓库通过 Composite Action 也可以执行环境检查：

```yaml
- uses: weepwood/yso@main
  with:
    command: doctor
    yuque-token: ${{ secrets.YUQUE_TOKEN }}
```

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
npm install
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

`GITHUB_TOKEN` 建议使用只授权目标 Vault 仓库的 Fine-grained PAT，并尽量收紧权限。

## 7. 推荐启用顺序

1. 先只安装 `doctor`，确认配置和 CLI；
2. 手动 `workflow_dispatch` 执行一次 `pull`，检查生成路径和 Frontmatter；
3. 手动执行一次 `push`；
4. 确认 `.yso/state.json` 与语雀文档对应正确；
5. 再启用语雀 Webhook；
6. 最后保留每日 `reconcile` 作为兜底。

不要一开始就对已有大量笔记同时开放自动 push + pull。首次迁移应先选一个小知识库验证映射。
