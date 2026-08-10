# 开源项目调研与方案取舍

> 调研日期：2026-08-10

## 结论

YSO 不再重复开发 Obsidian 插件，而定位为 **Headless 双向同步引擎**：

- Obsidian ↔ GitHub：交给成熟的 Obsidian Git / GitHub Sync 类插件；
- GitHub ↔ 语雀：由 YSO 在 GitHub Actions 中处理；
- 语雀 → GitHub 的实时触发：语雀 Webhook → Cloudflare Worker → `repository_dispatch`；
- 定时 `reconcile`：只作为 Webhook 漏推、Action 失败、状态损坏后的最终一致性兜底。

## 调研项目一览

| 项目 | 方向 | 主要借鉴 | YSO 是否复用 |
|---|---|---|---|
| [chick26/obsidian-sync-yuque](https://github.com/chick26/obsidian-sync-yuque) | Obsidian → 语雀插件 | 插件侧文档上传 | 不直接复用，项目已停更 |
| [x-cold/yuque-hexo](https://github.com/x-cold/yuque-hexo) | 语雀 → Markdown | 增量游标、缓存、图片适配器 | 采用设计思想 |
| [Elog](https://elog.1874.cool/) | 多写作平台 → Markdown/部署 | adapter、缓存、目录映射 | 采用分层思想 |
| [Vinzent03/obsidian-git](https://github.com/Vinzent03/obsidian-git) | Obsidian ↔ Git | 自动 commit/pull/push | 直接作为 Vault→GitHub 推荐链路 |
| [silvanocerza/obsidian-github-sync](https://github.com/silvanocerza/obsidian-github-sync) | Gitless GitHub Sync | 移动端/API 同步与冲突 UI | 作为移动端备选思路 |
| [vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) | 实时双向同步 | 三方冲突/非重叠合并 | 采用保守三方基线模型 |
| [yuque/yuque-open-cli](https://github.com/yuque/yuque-open-cli) | 官方语雀 CLI | list/get/create/update/delete/version | **直接依赖** |

## 1. chick26/obsidian-sync-yuque

早期 Obsidian 插件，直接在插件里调用语雀接口并上传当前文档。项目已停止维护。

**可借鉴**：Obsidian 命令面板、知识库选择、Markdown 直接上传。

**不采用**：把 Token 和同步核心绑定在 Obsidian 客户端；缺少可靠的双向基线、增量对账和服务器端事件处理。

## 2. 已有代码资产（非开源调研对象）

现有的 Obsidian 端语雀同步代码已经实现：

- 语雀 API v2 文档读取/创建/更新；
- `yuque_link` Frontmatter 关联；
- 本地/语雀修改时间提示；
- 下载前本地备份；
- Markdown 与 Obsidian Wiki 图片引用识别；
- 语雀图片上传。

**YSO 直接兼容 `yuque_link`**，用于首次迁移时自动绑定已有文档，避免重复创建。图片上传仍可继续由该插件承担，YSO v0.1 不依赖语雀非公开图片接口。

## 3. x-cold/yuque-hexo

成熟的“语雀 → Markdown”同步工具，关键设计：

- 本地缓存 `yuque.json`；
- `lastGeneratePath` 增量时间戳；
- Markdown/Hexo adapter；
- 图片防盗链迁移到 COS/OSS/Qiniu/GitHub 等；
- GitHub Actions 持续集成实践。

**YSO 采用**：增量扫描游标、适配器边界、图片处理与正文同步解耦。

## 4. Elog

Elog 将“写作平台 → 文档格式适配器 → 部署平台/图床”拆开，支持目录映射、Front Matter 与本地缓存。

**YSO 采用**：端口/适配器思想。语雀适配器、Vault 文件系统、状态存储、Webhook 网关彼此独立。

## 5. Obsidian Git / GitHub Gitless Sync

Obsidian Git 已提供成熟的自动 commit/pull/push；Gitless Sync 则证明通过 GitHub API 也可以处理移动端，但需要额外的冲突 UI 和同步状态。

**YSO 取舍**：不再自己实现 Vault↔GitHub。桌面优先使用 Obsidian Git；移动端可以继续选择其他现有方案。

## 6. Self-hosted LiveSync

它最值得借鉴的是冲突模型：共同历史基线、非重叠修改可合并、重叠修改必须保留冲突；同时明确警告“按最新时间覆盖”可能丢失数据。

**YSO v0.1 采用更保守策略**：

- 保存共同基线 `.yso/base/`；
- `Base/Local/Remote` 三方 Hash；
- 两边同时修改且内容不同 → `.yso/conflicts/`，绝不按时间戳覆盖；
- 删除先进入 `pendingDeletes`，不自动传播。

## 7. 语雀官方 yuque-open-cli

2026 年官方 CLI 已覆盖文档 list/get/create/update/delete/version，并支持 `--changed-at-gte`。

**YSO 直接依赖并固定 `yuque-open-cli@1.2.0`**，避免自己长期维护一套 Open API HTTP 客户端。

## 最终架构

```text
Obsidian
   │ Obsidian Git
   ▼
GitHub Repo
   │ push                         ▲ commit
   ▼                              │
GitHub Actions ─── YSO Engine ────┘
   │             │
   │             ├─ .yso/state.json
   │             ├─ .yso/base/
   │             └─ .yso/conflicts/
   │
   ├──────────── Yuque Open CLI ────────────► Yuque
   │                                           │
   │                                           │ Webhook
   │                                           ▼
   ◄── repository_dispatch ◄── Cloudflare Worker
```
