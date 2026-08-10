# YSO 生产部署与运维

本文描述从“验证通过”进入长期运行后的推荐配置。目标是：**最小权限、可回滚、可观测、删除保守、冲突不静默覆盖**。

## 1. 推荐生产拓扑

```text
Obsidian
  │ Obsidian Git
  ▼
Private Vault Repository
  │
  ├─ Doctor / Plan / Pull / Reconcile
  │       │
  │       └─ YSO Engine (固定 commit SHA / release tag)
  │
  └─ repository_dispatch ◄─ Cloudflare Worker ◄─ Yuque Webhook
                                  │
                                  └─ GitHub fine-grained token
```

生产 Vault 与公开的 `weepwood/yso` 引擎仓库应分离。不要把真实 Token、Webhook Secret 或私有 Vault 内容提交到 YSO 源码仓库。

## 2. GitHub Token 最小权限

Worker 调用：

```text
POST /repos/{owner}/{repo}/dispatches
```

GitHub 官方文档要求 fine-grained token 对**目标 Vault 仓库**拥有：

```text
Contents: write
```

建议：

1. 使用 fine-grained personal access token 或 GitHub App installation token；
2. Repository access 只选择目标 Private Vault 仓库；
3. Repository permissions 只开启 `Contents: Read and write`；
4. 不给 Administration、Issues、Pull requests 等无关权限；
5. 设置合理过期时间并定期轮换。

官方说明：<https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event>

> 如果未来把 Worker 从 `repository_dispatch` 改为 `workflow_dispatch`，最低权限会不同，不应直接复用本节结论。

## 3. Cloudflare Worker 配置

`worker/wrangler.toml` 默认使用：

```toml
[vars]
GITHUB_OWNER = "CHANGE_ME"
GITHUB_REPO = "CHANGE_ME"

[secrets]
required = ["GITHUB_TOKEN", "WEBHOOK_SECRET"]

[observability]
enabled = true
head_sampling_rate = 1
```

部署前必须把 `CHANGE_ME` 改成实际目标仓库，否则 Worker 会主动返回 500，避免误转发。

### 设置 Secrets

```bash
cd worker
npm ci
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put WEBHOOK_SECRET
```

`WEBHOOK_SECRET` 应使用高熵随机值，不要复用 Yuque Token、GitHub Token 或其他密码。

生成示例：

```bash
openssl rand -hex 32
```

### 部署

```bash
npm run deploy
```

部署完成后先检查健康端点：

```bash
curl -i https://<worker-domain>/
```

应得到：

```text
yso webhook gateway: ok
```

Worker 会同时返回：

```text
X-YSO-Request-Id: <uuid>
Cache-Control: no-store
```

## 4. Webhook 鉴权

Worker 支持两种 Secret 传递方式。

优先：

```text
X-YSO-Webhook-Secret: <WEBHOOK_SECRET>
```

兼容只允许填写 URL 的 Webhook 平台：

```text
https://<worker-domain>/?token=<WEBHOOK_SECRET>
```

如果请求同时带 Header 与 query token，**Header 优先**。

当前没有对未知的 Yuque 官方签名协议进行猜测实现。拿到可验证的真实 Yuque Webhook 请求样本后，再增加官方签名校验。

## 5. Worker 安全边界

Worker 当前具备：

- 只接受 `POST` Webhook；
- GET 仅用于健康检查；
- Webhook Secret 校验；
- 最大请求体 256 KiB；
- 不把完整 Yuque payload 转发到 GitHub；
- 只提取 `doc_id` / `action` 作为提示；
- GitHub 429 / 5xx 最多重试 3 次；
- GitHub 非 429 的 4xx 不重试；
- 每次请求生成 `request_id`；
- 结构化日志不记录 Token、Secret 或完整正文。

Webhook 只是“发生变化”的唤醒信号。真正的同步状态仍由 YSO 重新调用 Yuque API/CLI 获取，因此不信任 payload 中的正文内容。

## 6. Cloudflare 可观测性

项目已启用 Workers Logs：

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

生产初期建议保留 100% 日志采样；流量明显增长后再降低采样率。

实时查看：

```bash
cd worker
npx wrangler tail
```

Worker 使用结构化 JSON 日志，主要事件：

```text
webhook_received
github_dispatch_retry
github_dispatch_succeeded
github_dispatch_failed
authentication_failed
payload_too_large
configuration_error
```

排障时优先使用 `X-YSO-Request-Id` / `request_id` 串联：

```text
Yuque request
  → Worker log request_id
  → GitHub repository_dispatch client_payload.request_id
  → GitHub Actions log
```

Cloudflare 文档：

- <https://developers.cloudflare.com/workers/observability/logs/workers-logs/>
- <https://developers.cloudflare.com/workers/observability/logs/real-time-logs/>

## 7. GitHub Actions 生产工作流

建议目标 Vault 仓库长期只保留：

```text
YSO Doctor        手动
YSO Plan          手动 + yso.config.json 变化时
YSO Pull          手动
YSO Yuque Webhook repository_dispatch 自动触发 Pull
```

如果生产配置确实使用 `bidirectional`，再增加受控的 Push / Reconcile；不要仅因为引擎支持双向就默认给所有目录开启双向。

所有 reusable workflow 与 `engine-ref` 应锁定到**同一 commit SHA 或正式 release tag**，不要一个使用 `main`、另一个使用 SHA。

## 8. 上线前检查

按顺序执行：

```text
Doctor → Plan → Pull → Plan
```

生产 Plan 的理想状态：

```text
remote-untracked=0
local-untracked=0
missing-local=0
remote-deleted-tracked=0
```

`pending-deletes` 可以非 0，但必须是人工已经理解并接受的历史删除记录。

如果出现以下任一状态，不应直接开启自动同步：

```text
missing-local > 0
remote-deleted-tracked > 0
unexpected local-untracked > 0
unexpected remote-untracked > 0
```

## 9. 删除与冲突原则

YSO 当前采用保守策略：

- 本地删除不会自动删除 Yuque；
- Yuque 删除不会自动删除本地；
- 删除只进入 `pendingDeletes`；
- 两端同时修改会进入 `.yso/conflicts/`；
- 冲突时不使用时间戳自动覆盖任一方。

因此长期运行时应把 `.yso/state.json`、`.yso/base/`、`.yso/conflicts/` 一起纳入 Git 版本控制。

## 10. 紧急停机与回滚

如果出现异常同步：

1. 在 GitHub Actions 中禁用 `YSO Yuque Webhook` workflow，或暂时删除 `repository_dispatch` trigger；
2. 在 Cloudflare 中撤销/轮换 `GITHUB_TOKEN`；
3. 不要删除 `.yso/state.json`；
4. 运行 `YSO Plan` 确认当前三方状态；
5. 使用 Git 回滚 Vault 文件，但保留冲突证据；
6. 修复后先运行 Doctor + Plan，再恢复自动 Webhook。

如果只是 Worker 误配置，可把 `GITHUB_REPO` 暂时改回 `CHANGE_ME` 后重新部署，Worker 会拒绝所有转发。

## 11. Token 轮换

推荐轮换顺序：

```text
创建新 GitHub Token
  → 更新 Cloudflare GITHUB_TOKEN
  → 发送一次测试 Webhook
  → 确认 repository_dispatch 成功
  → 撤销旧 Token
```

Webhook Secret 轮换时，需要同步更新 Worker Secret 与 Yuque Webhook URL/Header 配置，避免出现短暂 401。
