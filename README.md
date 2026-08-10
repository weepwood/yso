# YSO — Yuque ↔ Obsidian Sync

YSO 是一个面向 GitHub Actions 的 **语雀 ↔ Git/Obsidian 双向同步引擎**。

它不重新实现 Obsidian 的 Git 同步：Obsidian Git 负责 `Vault ↔ GitHub`，YSO 专注处理 `GitHub ↔ 语雀` 的文档映射、增量拉取、三方冲突检测、Webhook 触发与最终一致性对账。

## 当前状态

v0.2 已包含：

- `push`：本地 Markdown → 语雀；
- `pull`：语雀增量变化 → 本地 Markdown；
- `reconcile`：全量拉取后再扫描本地；
- `doctor`：检查配置、Vault、Token、语雀 CLI 与映射知识库可访问性；
- `plan`：**零写入**预演同步规模、删除/缺失风险，以及配置外孤儿 state；
- 官方 `yuque-open-cli@1.1.0`；
- `.yso/state.json` 文档 ID/路径映射；
- `.yso/base/` 共同基线；
- `.yso/conflicts/` 三方冲突留档；
- 删除软检测，不自动删除任意一端；
- 兼容 `yuque_link` Frontmatter；
- Cloudflare Worker Webhook 网关；
- **Composite GitHub Action**：`uses: weepwood/yso@...`；
- **Reusable Workflow**：供独立 Private Vault 仓库复用；
- Vault 接入工作流模板与接入文档；
- CI、配置路径安全校验与 npm lockfile 维护。

已完成的真实链路验证包括：首次 Pull、增量 Pull、无变化幂等、创建/更新 Push、双边冲突保护、冲突恢复、本地/远端删除保护、重命名保持同一 docId，以及 Worker 源码 → GitHub `repository_dispatch` → YSO Pull。**尚未宣称完成的是 Cloudflare 公网部署后的真实 Yuque Webhook 投递**；该步骤取决于部署环境和 Yuque Webhook 配置。

暂未自动转换 Obsidian `[[wikilink]]`、`![[embed]]` 与本地图片。发现这些语法时会提示；图片目前可继续使用已有 Obsidian 端语雀插件，或后续接对象存储 adapter。

## 架构

```text
Obsidian
   │ Obsidian Git
   ▼
Private Vault Repo
   │ push                         ▲ sync commit
   ▼                              │
GitHub Actions ─── YSO Engine ────┘
   │
   ├──────── Yuque Open CLI ───────► Yuque
   │                                  │
   │                                  │ Webhook
   ◄─ repository_dispatch ─ Worker ◄──┘
```

`weepwood/yso` 建议只保存同步引擎源码。**真实 Vault 应使用独立 Private Repository。**

## 快速开始

### 1. 在 Vault 仓库创建配置

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
    }
  ]
}
```

`vaultDir`、`stateDir`、`localDir` 必须是仓库/Vault 内的相对路径；YSO 会拒绝 `../`、绝对路径和 Windows 盘符路径。

### 2. 添加 GitHub Secrets

Vault 仓库 Settings → Secrets and variables → Actions：

- `YUQUE_TOKEN`：必需；
- `YUQUE_HOST`：企业空间或自定义 Host 才需要。

### 3. 先预演，再同步

完整步骤见 [`docs/vault-setup.md`](docs/vault-setup.md)。建议首次接入按顺序运行：

```text
Doctor → Plan → Pilot Pull → Push → Webhook → Reconcile
```

`plan` 是只读命令：它不会创建 `.yso/`，也不会修改 Vault、state 或语雀。详细说明见 [`docs/plan.md`](docs/plan.md)。

工作流模板位于 [`examples/workflows/`](examples/workflows/)：

- `yso-plan.yml`
- `yso-push.yml`
- `yso-pull.yml`
- `yso-reconcile.yml`

稳定使用时建议把 Reusable Workflow 与 `engine-ref` 一起锁到同一个 release tag 或 commit SHA。

## 生产部署

完整的最小权限、Cloudflare Worker、日志、Webhook、回滚与 Token 轮换说明见：

**[`docs/production.md`](docs/production.md)**

生产 Vault 建议长期只保留真正需要的工作流，例如：

```text
YSO Doctor        手动
YSO Plan          手动 + 配置变化
YSO Pull          手动
YSO Yuque Webhook repository_dispatch 自动 Pull
```

只有明确需要 GitHub → 语雀时，才对对应 mapping 开启 `push` / `bidirectional`，不要因为引擎支持双向就默认把整个 Vault 改成双向。

## Composite Action

如果希望自己编排 workflow：

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0

- uses: weepwood/yso@<commit-sha>
  with:
    command: plan
    config-path: yso.config.json
    yuque-token: ${{ secrets.YUQUE_TOKEN }}
    yuque-host: ${{ secrets.YUQUE_HOST }}
```

支持命令：`push`、`pull`、`reconcile`、`doctor`、`plan`。

## 本地运行

Node.js 20+：

```bash
npm ci
export YUQUE_TOKEN='...'
npm run doctor
npm run sync -- plan
npm run pull
npm run push
npm run reconcile
```

企业语雀可额外设置 `YUQUE_HOST`。

## Webhook Worker

**先修改 `worker/wrangler.toml` 中的目标仓库。默认 `CHANGE_ME` 会拒绝转发，防止误把 Webhook 发到 YSO 源码仓库。**

```toml
[vars]
GITHUB_OWNER = "your-github-name"
GITHUB_REPO = "your-private-vault-repo"
```

再执行：

```bash
cd worker
npm ci
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

语雀 Webhook 可指向：

```text
https://<worker-domain>/?token=<WEBHOOK_SECRET>
```

如果 Webhook 平台支持自定义 Header，优先使用：

```text
X-YSO-Webhook-Secret: <WEBHOOK_SECRET>
```

Worker 当前还包含：

- 256 KiB Webhook 请求体上限；
- Header Secret 优先；
- 每请求 UUID `X-YSO-Request-Id`；
- 结构化 Worker Logs；
- GitHub 429 / 5xx 有界重试；
- 不转发完整 Yuque payload；
- Wrangler required secrets 校验与 observability。

Worker 把 Webhook 当作“有变化”的唤醒信号，核心同步不依赖具体 payload；Action 会重新通过语雀官方 API/CLI 查询实际增量变化。

> 目前仍未取得一份可验证的真实语雀 Webhook 签名样本，因此没有猜测官方签名字段。当前使用高熵 Webhook Secret；拿到真实请求样本后再补签名校验。

## 冲突模型

YSO 不按“最后修改时间”直接覆盖：

```text
Base != Local
Base != Remote
Local != Remote
```

会生成：

```text
.yso/conflicts/<doc>/<fingerprint>/
├── base.md
├── local.md
├── yuque.md
└── meta.json
```

两端原内容均不自动覆盖。

## 删除

v0.2 仍采用软删除检测。删除事件进入 `.yso/state.json` 的 `pendingDeletes`，不会自动传播删除。

当 mapping 从配置中移除后，如果 `.yso/state.json` 仍有该知识库的跟踪项或 pending delete，`plan` 会输出 `[plan:orphan]`；YSO 不会擅自删除这些历史状态。

## 开源项目调研

本项目在实施前分析了 Obsidian/语雀/Markdown 同步相关项目，并据此决定不重复开发 Obsidian 插件。详细记录见 [`docs/oss-analysis.md`](docs/oss-analysis.md)。

## 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

Worker：

```bash
cd worker
npm ci
npm test
npx wrangler deploy --dry-run
```

`package-lock.json` 与 `worker/package-lock.json` 已纳入仓库；CI 和 Composite Action 使用 `npm ci`。修改任一 `package.json` 后，`Refresh lockfiles` workflow 会在 GitHub 公共 npm registry 中更新锁文件。

## Roadmap

- [ ] 基于真实语雀 Webhook 样本增加官方签名校验；
- [ ] Obsidian WikiLink ↔ 语雀链接 adapter；
- [ ] 图片/附件 adapter（优先对象存储）；
- [ ] 仅对互不重叠编辑执行文本级三方自动合并；
- [ ] 可确认的删除传播；
- [ ] TOC ↔ 文件夹目录映射；
- [ ] GitHub Issue / PR 冲突处理工作流；
- [ ] 正式版本 tag，并让示例默认锁定 release tag。

## License

MIT
