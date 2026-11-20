# 笺墨溪写作插件

ChatGPT Chat、Work 和 Codex 是写作工作台。文章、回收站和摘录保存在这个私人 Site 的 D1 数据库；书籍正文和旧数据备份保存在其 R2 文件存储。日常读写不访问腾讯云，不调用旧文字或语音模型 API。

**当前发布与导入进度见 [STATUS.md](STATUS.md)。发布成功不能代替真实工具验收。**

## 使用

1. 私人入口：[笺墨溪写作工具](https://jianmoxi-writing-tools.hanxueqing.chatgpt.site)。在 ChatGPT 的插件目录中安装、连接并选择同名插件。
2. 尝试「列出我的文章」「读取某篇文章」「查找鲁迅的作品」「收藏这一段」。
3. 修改前先读原文；只有用户要求保存或删除时才调用写入工具。字数较长的文章、章节按 `next_offset` 续读。
4. 引用链接指向本站受保护的原文数据页，保留作品原来的来源信息。原 PDF/EPUB 文件仍属于旧服务器备份，当前迁移的是已提取的完整章节文本。

插件目标支持 Chat、Work、Codex；各端实际显示与可用性以当前账号为准，不能将单个 Codex 对话测试宣称为三端均已实测。设备上仅保存在本机的草稿需单独导入。

## 数据与权限

- 沿用同一个 owner-private Site，不共享、不公开，R2 不开放公共访问。
- MCP 请求必须具备平台提供的真实登录身份；首次所有者访问绑定该 Site 的身份，后续其他身份被拒绝。
- 稿件编辑按修订号更新，冲突后要求重读，不允许分页片段覆盖全文。新稿 ID 在重试时保持相同 UUID，防止重复创建。
- 摘录服务核验对应章节的真实原句，重复收藏不会新增。回收站支持恢复。
- 迁移前的账号文字数据与聊天记录另存为私人压缩备份。历史聊天的归档不等于已恢复为 ChatGPT 的对话记忆；原文阅读与写作工具是当前范围。
- 不把作者文章、私人书籍、聊天记录、运行凭据放进公开 GitHub。`outputs/` 和本地环境文件必须保持忽略。

## 工具

| 工具 | 操作 |
| --- | --- |
| `workspace_info` | 云稿数量、作者确认的人设 |
| `list_articles` / `read_article` | 文章列表与分页原文 |
| `create_article` / `edit_article` | 新建、按原句精确改稿 |
| `trash_article` / `restore_article` | 回收站与恢复 |
| `search_library` / `read_library` | 按书名、作者、文集检索；读取章节原文 |
| `list_excerpts` / `save_excerpt` | 查找摘录、核验原句后收藏 |

书库当前检索范围为书名、作者和文集，不包含全库正文检索。全文可按作品 ID、章节和偏移读取。未开放的旧功能不应假称已迁入插件。

## 存储结构

`.openai/hosting.json` 保留 Site ID，绑定 `DB` 和 `BUCKET`。

D1 保存文章正文、编辑修订号、回收站状态、书籍元数据、摘录、账号标签、人设和迁移状态。R2 每部作品一个私有数据包，包含章节索引与原来的压缩正文；读取时只取指定章节的字节范围，避免整本大书进入内存，也避免把约 1 GB 的旧数据库原样迁入 D1。

早期反向轮询已撤回。`drizzle/0000_writing_relay.sql` 已应用，必须保持不变；新结构通过追加 `0001_hosted_workspace.sql` 创建。普通请求不创建或修改数据库结构。

## 开发与发布

- `worker/index.js`：stateless JSON-RPC MCP 入口、受保护的原文引用与备份下载。
- `worker/storage.js`：托管数据读写、身份隔离、修订号检查、R2 章节范围读取。
- `tools.json`：11 个正常工具；检查脚本核对部署目录一致。
- `scripts/check.mjs`：使用真实内存 SQLite 和 R2 测试适配器，覆盖导入、权限、并发修改、冲突、分页、引用、重试和回收站恢复。
- `scripts/build.mjs`：将模块合并为 Worker ESM 部署入口。
- `migration/export.py`：旧服务器只读快照导出，排除认证表和环境文件。
- `migration/run-local.mjs`、`migration/transfer.ps1`：凭据只从隐藏 stdin 接收，文件逐个 SHA256 校验，可在中断后重试。
- `bridge/`：旧腾讯云桥接与导出适配，只用于历史迁移，不属于新版运行依赖。

本地验证使用 Node.js 24 或更新版本运行 `node scripts/check.mjs`、`node scripts/build.mjs`。Sites 按此 Site 的 source helper 推送、打包、部署，保留已有 Site 身份，发布后用真实插件调用验收。

导入接口仅在 `MIGRATION_TOKEN` runtime secret 存在时启用，并受 Site 私人访问控制保护；导入完成、数量和原文核验通过后删除该 secret 并重新部署。日常使用不需要腾讯云连接密钥、个人 API key 或电脑常驻运行。

## 费用

官方当前说明：托管在 2026-12-31 前免费；2027-01-01 起按用量计费，Plus 每月提供共享的 125 credits 托管额度。拟定费率中，带存储的 Site 基础用量约 25 credits/月，D1 约 150 credits/GiB/月，文件约 3.75 credits/GiB/月，另计请求。约 328 MB 的章节文件存 R2，元数据与少量稿件存 D1，可显著降低数据库用量。实际费用仍需结合该账号所有 Sites 的总用量，不能承诺永久免费。

模型生成由当前 ChatGPT/Codex 对话承担，使用相应套餐额度。本插件工具不调用旧火山或千问模型。

## 官方依据

- [Sites 托管插件](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)
- [Sites 存储、套餐额度与拟定费率](https://learn.chatgpt.com/docs/sites)
- [Chat、Work、Codex 中的插件](https://learn.chatgpt.com/docs/plugins)