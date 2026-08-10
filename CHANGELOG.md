# Changelog

YSO 使用语义化版本思路记录公开版本。当前仍处于早期阶段，涉及 state 格式或冲突语义的破坏性调整会在发布说明中明确标记。

## v0.2.0 — 2026-08-10

首个经过真实语雀环境端到端验证的版本。

### 同步核心

- `push`：Git/Obsidian Markdown → 语雀；
- `pull`：语雀增量变化 → Git/Obsidian；
- `reconcile`：Pull 后进行本地全量对账；
- Base / Local / Remote 三方决策，不使用“最后修改时间覆盖”；
- 同一文档重命名保持原语雀 docId；
- Bootstrap 可通过 `yuque_link` 或唯一正文匹配认领已有文档；
- Frontmatter 本地保留，语雀正文不携带 Frontmatter；
- 自动维护 `yuque_link`、`yuque_title`、`yuque_updated_at`。

### 安全模型

- 本地删除不会自动删除语雀；
- 语雀删除不会自动删除本地；
- 删除只进入 `pendingDeletes`；
- 双端同时修改时写入 `.yso/conflicts/`，不覆盖任意一端；
- 冲突目录按内容指纹幂等；
- `vaultDir` / `stateDir` / mapping 路径限制在项目内部；
- 无变化 Pull 不推进扫描游标、不改 state、不制造空同步提交。

### Doctor / Plan

- `doctor` 检查 Vault、配置、Token、官方 Yuque CLI 与映射知识库可访问性；
- `plan` 保证零写入；
- Plan 展示本地/远端/已跟踪/未跟踪/缺失/删除数量；
- Plan 检测移除 mapping 后遗留的 orphan state；
- Plan 展开 `pendingDeletes` 的方向、docId、标题、slug、路径与检测时间。

### GitHub 集成

- Composite Action；
- Reusable Workflow；
- Doctor / Plan / Pull / Push / Reconcile 示例；
- 工作流可固定到完整 commit SHA；
- npm lockfile + `npm ci`；
- CI 覆盖 typecheck、unit tests、build、Composite Action smoke、Worker tests 与 Wrangler dry-run。

### Webhook Worker

- Cloudflare Worker 将 Yuque Webhook 转为 GitHub `repository_dispatch`；
- Webhook payload 仅作为变化提示，实际数据重新从语雀 API/CLI 获取；
- 高熵 Secret 校验，Header 优先并兼容 query token；
- 256 KiB 请求体限制；
- 每请求 `X-YSO-Request-Id`；
- 结构化 Worker Logs；
- GitHub 429 / 5xx 有界重试；
- 不记录 Token、Secret 或完整正文；
- Cloudflare observability 默认启用。

### 已完成真实验证

- 首次全量 Pull；
- 真实增量 Pull；
- 无变化 Pull 幂等；
- 创建语雀文档；
- 更新已有文档且 docId 不变；
- 双端分叉产生冲突且两边内容均保留；
- 冲突人工恢复后三方重新收敛；
- 远端单改 → Pull；
- 本地单改 → Push；
- 本地重命名不重复创建远端文档；
- 本地删除仅产生 pending tombstone；
- 远端删除保留本地副本并产生 pending tombstone；
- Worker 源码 → GitHub repository_dispatch → YSO Pull 真实链路。

### 尚未完成 / 已知限制

- 尚未完成 Cloudflare 公网部署后的真实 Yuque Webhook 投递验证；
- 尚未取得可验证的 Yuque 官方 Webhook 签名样本，因此没有猜测签名协议；
- 暂不自动转换 Obsidian `[[wikilink]]`、`![[embed]]`；
- 暂不自动上传本地图片/附件；
- 暂不自动传播删除；
- 冲突暂不做文本级自动合并；
- 大型知识库的全量 `reconcile` 仍有远端逐篇读取成本。
