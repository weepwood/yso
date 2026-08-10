# 只读同步预演：`yso plan`

`plan` 用于首次接入、修改映射、升级引擎或怀疑同步状态异常时，在真正执行 `pull` / `push` / `reconcile` 前检查同步范围和风险。

```bash
export YUQUE_TOKEN='...'
npm run sync -- plan
```

## 零写入保证

它只读取：

- `yso.config.json`；
- 本地 Markdown 文件列表；
- 已存在的 `.yso/state.json`（若不存在则视为空状态）；
- 已存在的 `.yso/base/` 基线文件；
- 语雀当前文档列表与删除文档列表。

它**不会**：

- 创建 `.yso/`；
- 修改 `state.json`；
- 写入、重命名或删除本地 Markdown；
- 创建、更新或删除语雀文档；
- 修复或删除损坏的 base/state。

## Mapping 汇总

每个 mapping 会输出：

- `local`：映射目录中的本地文档数；
- `remote`：语雀当前文档数；
- `tracked`：双方已被 state 关联的文档数；
- `remote-untracked`：尚未进入 state 的远端文档数；
- `local-untracked`：尚未进入 state 的本地文档数；
- `missing-local`：state 中存在但本地文件已缺失的文档数；
- `remote-deleted-tracked`：语雀已删除且曾被 state 跟踪的文档数；
- `pending-deletes`：已经记录的待人工确认删除项。

示例：

```text
[plan] weepwood/obsidian mode=pull localDir=docs/obsidian \
local=21 remote=21 tracked=21 remote-untracked=0 local-untracked=0 \
missing-local=0 remote-deleted-tracked=0 pending-deletes=2
```

## 删除风险明细

当 mapping 存在 `pendingDeletes` 时，Plan 会继续输出具体条目，而不是只给一个数量：

```text
[plan:pending-delete] \
book=weepwood/obsidian \
direction=remote \
docId=271850188 \
title="色戒" \
slug=trash-9OxekX2W \
path=- \
detectedAt=2026-08-10T10:44:49.049Z
```

字段含义：

- `direction=local`：本地文件缺失，但不会自动删除语雀；
- `direction=remote`：语雀文档已删除，但不会自动删除本地；
- `title` / `slug`：优先从 state 获取；state 已无该文档时会尝试从语雀 deleted-doc 列表补齐；
- `path=-`：表示当前 state/tombstone 没有可恢复的本地路径信息。

`pendingDeletes` 是审计状态，不等于同步失败。YSO 不会仅因为它存在就自动执行删除。

## 配置外孤儿状态

如果一个 mapping 已从 `yso.config.json` 删除，但 `.yso/state.json` 还保留该知识库的文档或 tombstone，会输出：

```text
[plan:orphan] 配置外残留状态 tracked=1 pending-deletes=1 books=weepwood/old-book
```

这些条目不会参与当前 mapping，也不会被 YSO 自动清理。应先确认它们确实属于废弃配置，再人工删除对应 state/base/conflict。

## Base 完整性审计

三方冲突判断依赖：

```text
State baseHash
      ↕
.yso/base/<doc>.md
```

Plan 会对当前 mapping 中所有已跟踪文档执行只读校验：

```text
[plan:base] tracked=21 missing=0 hash-mismatch=0 orphan-files=0
```

四个指标：

- `tracked`：当前映射中需要基线的已跟踪文档数；
- `missing`：state 有文档，但对应 `.yso/base/*.md` 缺失；
- `hash-mismatch`：base 文件存在，但 `SHA-256(title + normalized body)` 与 state 的 `baseHash` 不一致；
- `orphan-files`：`.yso/base/` 中存在没有任何 state 文档对应的 Markdown 文件。

出现问题时会进一步输出：

```text
[plan:base-risk] missing key=... path=...
[plan:base-risk] hash-mismatch key=... path=...
[plan:base-risk] orphan-file=...
```

**不要自动重建或删除这些文件。** Base 损坏可能改变三方冲突判断语义，应先通过 Git 历史恢复正确 state/base，再执行同步。

## Plan 的边界

`plan` 不读取每一篇**当前远端正文**，因此不会声称能精确预测 `push / pull / conflict` 的最终内容决策。它读取远端元数据、deleted-doc 元数据和本地同步基线，目标是提前暴露：

```text
映射范围风险
删除/缺失风险
配置孤儿风险
同步基线完整性风险
```

需要真正执行三方内容决策时，仍由 `pull` / `push` / `reconcile` 获取实际远端正文。
