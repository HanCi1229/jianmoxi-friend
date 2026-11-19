# 笺墨溪写作插件

ChatGPT 的 Chat、Work 和 Codex 作为写作工作台，腾讯云保存 Friend 的文章、书库和摘录。Plus 使用 Sites 托管的私人插件入口。

## 使用

1. 发布后的私人入口为 https://jianmoxi-writing-tools.hanxueqing.chatgpt.site 。
2. 在 ChatGPT 的插件目录中找到「笺墨溪写作工具」，完成安装与连接。
3. 新建 Chat、Work 或 Codex 对话，选择插件，尝试「列出我的云端文章」「在书库里找鲁迅的作品」。
4. 改稿时先读原文，再提出修改。只有用户要求保存时才使用写入工具。

插件的安装与各端可见性以账号显示为准。Sites 发布会生成对应插件，无须在 Plus 中走企业工作区的远程 MCP 添加入口。

## 数据和费用

这个私人插件绑定既有 Friend 的 `owner` 账号。插件的权限边界是 owner-private Site，服务端另外验证专用连接密钥。不得把 Site 改为共享或公开后继续使用同一个账号绑定。需要多账号使用时，应先实现按 ChatGPT 用户绑定 Friend 账号。

工具只进行数据查询和保存，代码中没有模型调用。腾讯云主动连接私人 Site，工具参数和结果经 Sites 的临时队列传递，完成后删除，超时遗留记录在下一次调用时清理。阅读、分析和写作由所在 ChatGPT/Codex 对话完成，消耗对应套餐额度。腾讯云数据服务继续运行。独立 Android、网页和第三方模型接口进入旧客户端归档，迁移完成后关闭旧客户端入口。手机或电脑上仅保存在本机的草稿不会自动迁入云端。

## 工具

| 工具 | 操作 |
| --- | --- |
| `workspace_info` | 云稿数量、账号和作者确认的人设 |
| `list_articles` / `read_article` | 云稿列表、标题筛选和分页原文 |
| `create_article` / `edit_article` | 新建文章、按原句精确改稿 |
| `trash_article` / `restore_article` | 回收站和恢复 |
| `search_library` / `read_library` | 书库搜索、章节、原文和来源 |
| `list_excerpts` / `save_excerpt` | 摘录查找和原句核验后收藏 |

更新必须带当前 `expected_revision`，版本不一致返回冲突。创建重试沿用相同 UUID。改稿只替换唯一匹配的原文，不拿分页片段覆盖全文。文章回收站操作可恢复。书库收藏由原来的后端逐字核验。

## 开发与发布

- `worker/index.js` 是 Sites MCP 入口，支持 stateless JSON-RPC 和 Streamable HTTP 初始化。
- `tools.json` 是工具目录，`scripts/check.mjs` 验证 Worker 目录与后端目录一致。
- `bridge/server.py` 是腾讯云数据桥接服务，通过既有账号接口操作数据。
- 专用密钥只配置在 Sites runtime secret 和 `/etc/jianmoxi-writing-tools.env`，不要提交到 GitHub。服务器的 `JIANMOXI_SITES_AUTH` 使用平台返回的 Site 专用服务访问凭据；连接权限撤销后需由 Site 所有者重新授权。
- `backend/friend-persona.md` 继续作为人设来源，由 `workspace_info` 提供给工作台。

本地检查和构建可运行 `node scripts/check.mjs`、`node scripts/build.mjs`。Sites 发布应通过对应 Site 的 source helper 推送、打包和部署，`.openai/hosting.json` 中的 Site ID 必须保留。

腾讯云使用 Python 3.11，依赖见 `bridge/requirements.txt`。安装目录为 `/opt/jianmoxi-writing-tools`，systemd 单元见 `bridge/jianmoxi-writing-tools.service`。数据服务通过 `bridge/poller.py` 主动连接 Sites 的免费域名，不依赖腾讯云入站域名。服务的账号为 `xingzou`，绑定账号从 `JIANMOXI_ACCOUNT_ID` 配置读取，不从请求参数读取。

集成验收脚本 `bridge/smoke_test.py` 会创建临时隔离账号，验证新建、重试、改稿冲突、回收站、原文和摘录，然后清理该测试账号。它需要在服务器运行，不修改作者的现有文章。

## 官方接入依据

- [Sites 托管插件](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)
- [各套餐的插件与 Sites 入口](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
- [Chat、Work、Codex 中的插件](https://learn.chatgpt.com/docs/plugins)
