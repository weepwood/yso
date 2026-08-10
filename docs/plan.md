# 只读同步预演：`yso plan`

`plan` 用于首次接入或修改映射后，在真正执行 `pull` / `push` / `reconcile` 前检查同步规模。

```bash
export YUQUE_TOKEN='...'
npm run sync -- plan
```

它只读取：

- `yso.config.json`；
- 本地 Markdown 文件列表；
- 已存在的 `.yso/state.json`（若不存在则视为空状态）；
- 语雀当前文档列表与删除文档列表。

它**不会**：

- 创建 `.yso/`；
- 修改 `state.json`；
- 写入或删除本地 Markdown；
- 创建、更新或删除语雀文档。

每个 mapping 会输出：

- `local`：映射目录中的本地文档数；
- `remote`：语雀当前文档数；
- `tracked`：双方已被 state 关联的文档数；
- `remote-untracked`：尚未进入 state 的远端文档数；
- `local-untracked`：尚未进入 state 的本地文档数；
- `missing-local`：state 中存在但本地文件已缺失的文档数；
- `remote-deleted-tracked`：语雀已删除且曾被 state 跟踪的文档数；
- `pending-deletes`：已经记录的待人工确认删除项。

`plan` 不读取每一篇远端正文，因此不会声称能精确预测 `push/pull/conflict` 三方内容决策；它的目标是先暴露映射范围和删除风险。
