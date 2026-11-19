# 笺墨溪写作插件

ChatGPT 的 Chat、Work 和 Codex 作为写作工作台，腾讯云保存 Friend 的文章、书库和摘录。Plus 使用 Sites 托管的私人插件入口。

## 使用

1. 私人入口：[笺墨溪写作工具](https://jianmoxi-writing-tools.hanxueqing.chatgpt.site)。
2. 在 ChatGPT 插件目录中找到「笺墨溪写作工具」，安装并连接。
3. 在 Chat、Work 或 Codex 对话中选择插件，尝试「列出我的云端文章」「在书库里找鲁迅的作品」。
4. 改稿时先读原文，再提出修改。只有用户要求保存时才使用写入工具。

插件的安装与各端可见性以账号显示为准。Sites 发布会生成对应插件，无须在 Plus 中走企业工作区的远程 MCP 添加入口。发布成功不等于腾讯云连接成功，必须实际调用工具验收。

## 数据、权限和费用

这个私人插件绑定既有 Friend 的 `owner` 账号。插件的权限边界是 owner-private Site，腾讯云另外验证专用连接密钥。不得把 Site 改为共享或公开后继续使用同一个账号绑定。多账号使用前须实现按 ChatGPT 用户绑定 Friend 账号。

工具只进行数据查询和保存，没有模型调用。阅读、分析和写作由当前 ChatGPT/Codex 对话完成，消耗对应套餐额度；不会通过本插件调用旧文字和语音模型。腾讯云继续承载数据。手机或电脑上仅存在本机的草稿不会自动迁入云端。旧客户端代码保留作归档，数据迁移确认前不删除。

## 工具

| 工具 | 操作 |
| --- | --- |
| `workspace_info` | 云稿数量、账号和作者确认的人设 |
| `list_articles` / `read_article` | 云稿列表、标题筛选和分页原文 |
| `create_article` / `edit_article` | 新建文章、按原句精确改稿 |
| `trash_article` / `restore_article` | 回收站和恢复 |
| `search_library` / `read_library` | 书库搜索、章节、原文和来源 |
| `list_excerpts` / `save_excerpt` | 摘录查找和原句核验后收藏 |

修改须带当前 `expected_revision`，版本不一致返回冲突。创建重试沿用相同 UUID。改稿只替换唯一匹配的原文，不拿分页片段覆盖全文。回收站可恢复。摘录由原后端逐字核验。

## 免费域名试用方案

Sites 提供固定的私人插件域名。腾讯云数据桥通过 Cloudflare Quick Tunnel 的临时 HTTPS 域名供 Sites 访问，入口只开放专用密钥认证的 `/v1`，不开放整个旧站。隧道在腾讯云上运行，不依赖个人电脑开机。

Quick Tunnel 不需要购买域名或创建 Cloudflare 账号，但官方定位是测试和开发，没有可用性保证。**隧道进程重启后地址会变化**，必须把新地址写入该 Site 的 `JIANMOXI_BRIDGE_URL`，再重新部署保存版本。systemd 重启只能恢复隧道进程，不能自动更新 Sites 的地址；不能当作固定生产域名。长期使用应迁到固定域名的命名隧道或可达的 HTTPS 数据服务。

最初尝试的 sslip.io 免费域名被腾讯云/DNSPod 的 HTTP 校验拦截；Sites 直连 IP 受托管环境限制；腾讯云主动轮询私人 Site 返回 Cloudflare 403。相应失败方案已撤回，未降低认证或关闭 TLS 校验。

## 开发与发布

- `worker/index.js`：Sites 的 stateless JSON-RPC MCP 入口；`tools.json` 是工具目录。
- `bridge/server.py`：腾讯云数据服务，只监听 `127.0.0.1:4190`，调用原有账号 API。
- `bridge/jianmoxi-writing-tools.service`：以 `xingzou` 用户运行桥接服务。
- `bridge/jianmoxi-writing-tunnel.service`：以无特权用户运行官方 `cloudflared`。
- `bridge/deploy.py`：校验 GitHub blob 后部署；密钥只从 stdin 接收，失败回滚。
- `backend/friend-persona.md`：继续作为人设来源，由 `workspace_info` 返回，不向 GitHub 新增私人配置。

桥接密钥同时放在 Sites runtime secret 和服务器 `/etc/jianmoxi-writing-tools.env`（root 600），不要提交 GitHub。`JIANMOXI_BRIDGE_URL` 只在 Sites 配置。服务端绑定账号来自环境变量，不能从请求指定账号。旧 `JIANMOXI_SITES_AUTH` 和反向轮询已不使用。

`node scripts/check.mjs` 验证协议、认证、目录一致、HTTPS 调用、拒绝重定向和错误处理；`node scripts/build.mjs` 构建 Worker。Sites 通过该 Site 的 source helper 推送、打包和部署，保留 `.openai/hosting.json` 的 Site ID。早期反向轮询的 D1 迁移已应用，应保持不可变；当前运行代码不使用该队列。

腾讯云依赖见 `bridge/requirements.txt`，安装目录 `/opt/jianmoxi-writing-tools`。`bridge/smoke_test.py` 使用隔离测试账号验证新建、重试、改稿冲突、回收站、原文和摘录，不修改作者的现有文章。

## 官方依据

- [Sites 托管插件](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)
- [各套餐的插件入口](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
- [Chat、Work、Codex 中的插件](https://learn.chatgpt.com/docs/plugins)
- [Quick Tunnel 的免费入口和限制](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
