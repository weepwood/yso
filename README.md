# YSO — Yuque ↔ Obsidian Sync

YSO 是一个面向 GitHub Actions 的 **语雀 ↔ Git/Obsidian 双向同步引擎**。

它不重新实现 Obsidian 的 Git 同步，而是让成熟的 Obsidian Git 负责 `Vault ↔ GitHub`，YSO 负责 GitHub 与语雀之间最容易出错的部分：文档映射、增量拉取、三方冲突检测、Webhook 触发和最终一致性对账。

## 当前状态

v0.1 MVP 已包含：

- `push`：本地 Markdown → 语雀；
- `pull`：语雀增量变更 → 本地 Markdown；
- `reconcile`：全量拉取 + 本地扫描；
- 语雀官方 `yuque-open-cli@1.2.0`；
- `.yso/state.json` 文档 ID/路径映射；
- `.yso/base/` 共同基线；
- `.yso/conflicts/` 三方冲突留档；
- 删除软检测，不自动删除任意一端；
- 兼容现有 `yuque_link` Frontmatter；
- Cloudflare Worker Webhook 网关；
- GitHub Actions：push / webhook / nightly reconcile；
- 单元测试。

暂未自动处理 Obsidian `[[wikilink]]`、`![[embed]]` 与本地图片上传。发现这些语法时会给出警告；图片目前更适合继续使用已有 `weepwood/yuque-sync` 插件或独立对象存储方案。

## 为什么这样设计

在实施前先分析了现有项目，包括 `chick26/obsidian-sync-yuque`、`weepwood/yuque-sync`、`x-cold/yuque-hexo`、Elog、Obsidian Git、Gitless Sync 与 Self-hosted LiveSync。详细结论见 [`docs/oss-analysis.md`](docs/oss-analysis.md)。

核心取舍：**YSO 做 headless sync engine，不再造一个 Obsidian 插件。**

## 目录

```text
.
├── src/
│   ├── adapters/yuque-cli.ts
│   ├── core/
│   ├── cli.ts
│   ├── filesystem.ts
│   ├── state-store.ts
│   └── sync-engine.ts
├── worker/                  # Yuque Webhook → GitHub repository_dispatch
├── .github/workflows/
├── .yso/
│   ├── base/
│   └── conflicts/
├── docs/
└── yso.config.example.json
```

## 1. 准备配置

```bash
cp yso.config.example.json yso.config.json
```

示例：

```json
{
  "version": 1,
  "vaultDir": "vault",
  "stateDir": ".yso",
  "defaultMode": "bidirectional",
  "writeYuqueMetadata": true,
  "mappings": [
    {
      "localDir": "AI",
      "book": "your-login/ai",
      "mode": "bidirectional",
      "filename": "title"
    }
  ]
}
```

建议实际笔记使用**单独的私有 GitHub 仓库**。当前 `weepwood/yso` 是同步引擎源码仓库，不建议把私人 Vault 直接提交到公开的 YSO 仓库。

如果只是本地验证，也可以临时把 Vault 放在项目 `vault/`；正式使用时推荐把本项目作为同步引擎引入你的私有 Vault 仓库。

## 2. 本地验证

Node.js 20+：

```bash
npm install
export YUQUE_TOKEN='...'
npm run pull
npm run push
npm run reconcile
```

企业语雀可按官方 CLI 的方式额外设置 `YUQUE_HOST`。

## 3. GitHub Actions

仓库 Settings 中添加：

### Actions Secret

- `YUQUE_TOKEN`
- `YUQUE_HOST`（仅需要自定义 Host 时）

### Actions Variable

- `YSO_ENABLED=true`
- `YSO_VAULT_DIR=vault`（可选，用于 push workflow 的 commit 范围）

在 `YSO_ENABLED` 设置前，同步 workflow 不会实际运行，避免初始化项目时因为 Token/配置尚未准备而失败。

## 4. Cloudflare Worker

```bash
cd worker
npm install
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

`GITHUB_TOKEN` 建议使用只对目标仓库开放的 Fine-grained PAT，并只授予 **Contents: write**（GitHub 当前对 `repository_dispatch` 的最低写权限要求）。

部署完成后，在语雀知识库“消息推送 / Webhook”中填写：

```text
https://<worker-domain>/?token=<WEBHOOK_SECRET>
```

Worker 不依赖 Webhook payload 的具体结构。它只将事件转换为 `repository_dispatch`，真正的变更列表由语雀官方 API/CLI 再读取。

> 当前无法从自动化环境直接读取你提供的语雀官方 Webhook 页面（返回 403），因此 v0.1 不假设一个未经验证的官方签名字段。Worker 先使用高熵 URL Secret；后续拿到实际 Webhook 请求样本后，应再补官方签名验证。

## 5. Obsidian

推荐使用 Obsidian Git：

- Pull on startup；
- 自动 commit + pull + push；
- 桌面端作为首要使用场景。

语雀修改会经 Webhook 触发 Action，把变更 commit 回 GitHub；Obsidian 下一次自动 pull 后即可拿到。

## 冲突

YSO 不使用“最后修改时间覆盖”。

```text
Base != Local
Base != Remote
Local != Remote
```

时会生成：

```text
.yso/conflicts/<doc>/2026-.../
├── base.md
├── local.md
├── yuque.md
└── meta.json
```

原文件和语雀都不会被覆盖。

## 删除

v0.1 不自动传播删除。删除只会进入：

```json
{
  "pendingDeletes": []
}
```

后续版本再加入可确认的软删除/墓碑机制。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run check
```

> v0.1 源码已将直接依赖固定到明确版本。正式部署前建议在可正常访问 npmjs 的环境生成并提交 `package-lock.json`，之后将 CI 切换到 `npm ci`。

## Roadmap

- [ ] 根据真实语雀 Webhook 请求样本增加官方签名校验；
- [ ] Obsidian WikiLink ↔ 语雀链接 adapter；
- [ ] 图片/附件 adapter（优先对象存储，非公开上传接口作为可选插件）；
- [ ] 文本级三方自动合并：仅自动合并互不重叠的编辑；
- [ ] 可确认的删除传播；
- [ ] TOC ↔ 文件夹目录映射；
- [ ] GitHub Issue / PR 冲突工作流。

## License

MIT
