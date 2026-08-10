# YSO 架构设计

## 同步模型

每篇已绑定文档维护三个版本。同步指纹由 **标题 + 规范化正文** 共同计算：

- **Base**：上一次双方确认一致的正文；
- **Local**：Git/Obsidian 当前正文；
- **Remote**：语雀当前正文。

决策表：

| Local vs Base | Remote vs Base | 行为 |
|---|---|---|
| 相同 | 相同 | noop |
| 不同 | 相同 | push |
| 相同 | 不同 | pull |
| 不同且 Local=Remote | 不同 | 更新 Base |
| 不同 | 不同且不相等 | conflict |

冲突会完整保存 Base/Local/Yuque 三份正文，不会自动选择“更新时间最新”的版本。同一组冲突内容使用稳定 fingerprint 目录，重复 Webhook 不会制造重复冲突副本。

## 删除策略

v0.1 只检测删除，不传播删除。检测结果写入 `.yso/state.json` 的 `pendingDeletes`。

## 首次迁移

如果已有笔记包含：

```yaml
---
yuque_link: https://www.yuque.com/namespace/book/slug
---
```

YSO 会优先绑定现有语雀文档，而不是创建副本。如果本地与远端正文不同，会生成 bootstrap conflict。

如果没有 `yuque_link`，但同一映射目录中恰好只有一个未绑定本地文档与远端正文完全一致，YSO 会进行安全认领，避免首次双向同步产生重复文档。

## Webhook 设计

Webhook 只负责“唤醒”，而不是作为变更数据的权威来源：

1. 语雀向 Worker POST；
2. Worker 校验 `WEBHOOK_SECRET`；
3. Worker 调 GitHub `repository_dispatch`；
4. Action 执行 `yso pull`；
5. `pull` 依据 `lastYuqueScanAt` + `yuque doc list --changed-at-gte` 获取真实增量；
6. 已删除文档通过 `yuque doc list --deleted` 单独查询，只记录墓碑，不自动删除另一端。

因此即使语雀 Webhook payload 字段发生变化，只要事件仍能投递，核心同步不受影响。
