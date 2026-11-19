# 接入状态与继续步骤

更新时间：2026-11-20 01:32（北京时间）。

## 已完成

- 采用 Plus 可用的 Sites 私人插件路径，目标工作台为 ChatGPT Chat、Work、Codex。Site 只允许当前所有者，未公开数据。
- 免费固定插件入口：https://jianmoxi-writing-tools.hanxueqing.chatgpt.site 。
- Site ID：`appgprj_6aff25fed028819185213c7f5212890d`，后续必须复用，不能重新创建。
- 11 个工具已在当前 Codex 对话注册。后端隔离账号测试通过：创建、重试、分页、精确修改、版本冲突、回收站恢复、书库原文及摘录核验。
- Worker 检查和构建通过：协议、工具目录、身份校验、HTTPS 转发、拒绝重定向和冲突错误。
- GitHub `20b4992` 已保存 HTTPS 桥接与临时隧道方案；本状态文件所在提交还包括直连验证和准确的未完成标识。

## 线上实际情况

- Site 已发布，但**真实 `list_articles` 调用仍失败**，不是一个可用工作台。不能用发布成功代替端到端验收。
- 已部署的功能源提交为 `892b1accd7268a4b8269e1511163f543fb1a8348`；该 Site 的源仓库和 GitHub 主仓库提交号不同，内容应分别核对。
- 验证时 Sites 环境 revision 3：`JIANMOXI_BRIDGE_TOKEN` 为 secret；`JIANMOXI_BRIDGE_URL=https://49.234.43.25/writing-tools/v1`。后续若换隧道，应改 URL 并重新部署保存版本。
- 腾讯云现有 HTTP 桥接仍运行于 `127.0.0.1:4190`，公网 `/writing-tools/v1` 未带密钥返回 401。现有桥接的原始代码已部署，最新桥接改动仍待通过 GitHub blob 校验部署。
- `xingzou` 数据服务及旧 `jianmoxi-friend` 客户端服务保留，未因迁移删除文章、书库、账号、记忆或本机草稿。

## 当前阻塞

1. Sites 对现有 HTTPS IP 桥接的真实工具调用失败。外部直接访问该地址可得到预期的 401，不能据此推断托管 Worker 也能访问。
2. sslip.io 免费域名的证书校验被腾讯云/DNSPod 的域名拦截页阻断，未签发证书。
3. 腾讯云反向轮询私人 Site 返回 Cloudflare 403，此方案已撤回，`bridge/poller.py` 已删除。已应用的 D1 初始迁移保持不可变，当前代码不使用队列。
4. SSH 管理连接不稳定：小命令曾恢复，大文件上传仍超时。用户正查看腾讯云控制台。不得把 SSH 小命令成功视为部署完成。
5. 官方 `cloudflared` 2026.11.1 已在操作电脑下载并按 GitHub 官方 release 的 SHA256 校验，但上传腾讯云失败，**尚无通过验证的运行隧道**。服务器 staging 中可能有部分文件，绝不能未校验就执行。未增加付费域名、付费服务，也未关闭认证或 TLS 校验。

## 恢复后继续

1. 从腾讯云控制台确认实例状态、资源占用和远程登录是否正常，恢复可持续的 SSH 操作。现有密钥及 known_hosts 沿用原部署配置，不把内容写进 GitHub。
2. 将本目录的桥接代码和配置上传到 `/run/jianmoxi-plugin-stage`，按 GitHub blob SHA 校验后运行 `bridge/deploy.py`。它只从 stdin 接收现有专用 token 和 blob hashes，失败自动回滚；不要创建不同 token 导致两端不一致。
3. 从 Cloudflare 官方 release 安装并校验 `cloudflared`，使用 `bridge/jianmoxi-writing-tunnel.service` 仅转发 `127.0.0.1:4190`。确认无密钥不能读取数据，再将当前 `https://...trycloudflare.com/v1` 配置到本 Site 的 `JIANMOXI_BRIDGE_URL` 并部署。
4. 用真实插件调用 `list_articles`、`read_article`、`search_library`、`read_library`；写入链路使用服务器隔离账号测试。全部通过才标记迁移完成。Chat/Work/Codex 各端的实际选择与可见性仍需按账号验收，不能宣称已逐端实测。
5. 再确认设备本机草稿，关闭旧客户端入口和第三方模型调用。旧源码作为归档保留，数据服务继续运行。

Quick Tunnel 属于免费测试入口，重启后域名会变化，需重新绑定 Sites 并部署；没有稳定性保证，不能冒充固定生产域名。长期使用应换可用固定域名的命名隧道或数据服务。

专用密钥在 `/etc/jianmoxi-writing-tools.env` 和 Sites secrets；账号数据仍在 `/var/lib/xingzou`。本说明不包含任何密钥。暂停或交接时，应保持以上未完成状态，不能再次盲目尝试已确认失败的路径。
