# 笺墨溪-Friend · 项目交接文档

> 交接基准：`285789c`（2026-11-13 夜）
> 用途：接手人从「拿到仓库」到「能改第一行代码」的全部必要信息。
> 完整决策过程另见 `E:/2026-11-13-19-27-00/.workbuddy/memory/2026-11-13.md`（按时间逐条记录，含每一次判断的来由）。

---

## 一、产品是什么

借用 Ruilisi 的世界观，重构传统作家的孤独写作方式：**作者进入的不是「文字生产工具」，而是一个「文字创作世界」**，以 AI 陪伴的方式进行创作。

核心功能四项：**写作、陪伴、阅读、探索**（探索暂时不设计）。

融合来源：`HanCi1229/Ruilisi-AI-Friend`（桌面陪伴 / 世界观 / 人物与工程规范）＋ `HanCi1229/jianmoxi*`（文学创作 / 真实书库 / 设计令牌）。

---

## 二、寒辞已定判断（原样保留，不得改写）

这一节是产品的地基。接手人只在他明确说「没想好 / 你补 / 给思路」的空白处补全；有不同意见须单独、显式标一句，不混入方案正文，不擅自「优化」成自己认为更合理的版本。

1. 进来之后的首页 = **Ruilisi 桌面大屏**。
2. 一级模块只有两个：**聊天、写作**，可切换。
3. 写作模块只含 **文章创作、阅读** 两个功能，其余舍弃。
4. 写作可开启两种模式：**沉浸模式**与**陪伴模式**。
5. 沉浸模式与传统写作／办公软件类似（例如 WPS）。
6. 陪伴模式 = 写作版面融入**开头左面大屏**，AI **实时检测**作者写的内容，**不定时给出建议和想法**，或**日常聊天攀谈**帮作者缓解精神疲劳；后续补充：陪伴模式**整个背景换成首屏场景大屏**。
7. **常驻聊天框放在首页的桌面大屏**。
8. 保留／新增功能：**对话（聊天输入框）、语音输入、电话（可无障碍语音交流）、场景切换**。
9. **「一言」这个内容源原样保留**。
10. **不允许用视频背景**。
11. **不做角色立绘 / 锚点 / 桌宠**；直接把**带角色的背景图作为场景**，这些场景**都能自由切换**（现有四张）。
12. **不代笔**；引用逐字可回查，出处可点回阅读。

**协作约定**：沟通、汇报只输出重点，先给结论，最多 2–3 条必要信息；完整交付物（文件／代码／报告）一次给全，但 accompanying 文字从简。

---

## 三、仓库与分支

| 项 | 值 |
| --- | --- |
| 仓库 | `HanCi1229/jianmoxi-friend`（**私有**） |
| 默认分支 / 唯一分支 | `笺墨溪-Friend` |
| 本地路径 | `E:/2026-11-13-19-27-00/笺墨溪-Friend` |
| 远端 | `https://github.com/HanCi1229/jianmoxi-friend.git` |
| 交接时 HEAD | `285789cc0666943e5866ac08d9b2a7ba1523626a` |
| 受跟踪文件数 | 256 |

提交历史：

- `3cebd27` 融合初始化：迁入 Ruilisi 人物标准与工程规范，复制笺墨溪三仓库代码资料
- `44cdc60` 可运行原型：首页／聊天／写作四屏、三层共在、真实书库与静帧场景（无视频背景）
- `285789c` 背景改为四张带角色概念图并支持自由切换；移除锚位剪影，纸面收窄露出人物

**网络坑（重要）**：本机 `git` / `gh` 经代理 `127.0.0.1:63240` 常偶发 `schannel: server closed abruptly`、TLS handshake timeout、`github.com` CONNECT tunnel 502；`api.github.com` 反而稳定。核对远端时可用：

```bash
TOKEN=$(gh auth token 2>/dev/null)
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/HanCi1229/jianmoxi-friend/git/ref/heads/%E7%AC%BA%E5%A2%A8%E6%BA%AA-Friend"
```

中文分支名在 API 路径里必须 URL 编码；`gh api user/repos` 在 Git Bash 里不要带前导斜杠。GitHub 中文仓库名会被剥成 `--Friend`，故仓库名用英文，中文名保留在目录／分支／描述里。`git push` 失败时重试通常即可，实在不行按 Git Data API（blobs → tree → commit → update ref）兜底。

---

## 四、目录结构

| 目录 | 内容 | 来源 / 用途 |
| --- | --- | --- |
| `01_人物标准/` | 三视图、设定解析板、`Ruilisi_人物固定规范_v2.0.pdf`（3 份） | Ruilisi 可直接进入生产的资产；硬数值 165cm、约 6.8 头身。**人物仍标 CANDIDATE** |
| `02_工程规范/` | 状态与流程、场景与动效、测试与构建、状态口径（16 份，含 `build-static.cjs`／回归脚本） | Ruilisi 可直接进入生产的工程资产；当前仅作规范参考，未接入 `app/` |
| `03_笺墨溪/` | `jianmoxi`、`jianmoxi-launch`、`jianmoxi-portfolio` 三仓库副本 | 已去除嵌套 `.git`；`jianmoxi/data/library-modern.json` 与 `web-client/base.css` 是 `app/` 的数据／设计令牌来源 |
| `04_原型/` | `layout-1440.html`（主稿，四屏 1440×900 真实尺寸）、`buttons-layout.html`、`layout-inspiration.html`、`companion-scene.html`、`companion-frontend.html` | 静态设计稿，**不参与运行**，仅供比照版式 |
| `05_方案/` | `陪伴沉浸方案.html` | 市场调研／竞品矩阵／三层共在方案。注意：其中「身体层／锚位」部分已被后续判断覆盖（见二·11） |
| `app/` | **唯一可运行代码** | 见下两节 |

---

## 五、跑起来

```bash
cd E:/2026-11-13-19-27-00/笺墨溪-Friend/app
node serve.mjs
# 打开 http://127.0.0.1:4180/
```

- **零依赖**：不需要 `npm install`，没有 `package.json` 的 `start`，不要去跑 `npm start`。`PORT=xxxx node serve.mjs` 可改端口。
- 必须经 http 打开：`app.js` 用 `fetch('./data/library.json')`，`file://` 直接双击会加载失败并提示「书库数据未加载，请通过本地服务打开」。
- `serve.mjs` 是静态服务，保留 Range 支持便于日后加任意媒体，但**应用本身不加载视频**。

常用校验：

```bash
node --check app.js && node --check serve.mjs
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4180/
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4180/assets/videos/courtyard.mp4  # 应为 404
grep -rE '<video|\.mp4|\.webm' app/   # 应无命中
```

---

## 六、代码地图（`app/`）

| 文件 | 职责 |
| --- | --- |
| `index.html` | 四屏结构：首页桌面大屏／聊天／写作（文章创作 + 阅读）／沉浸；4 个 `.scene-bg` 与 4 个 `.scene-choice`；无 `#herAnchor`／`#herLabel` |
| `styles.css` | 场景静帧、左侧暖白 scrim（夜色两张 62%→4% 保证深色文字可读、右侧保留人物）、纸面、阅读、沉浸屏隐藏场景层；`prefers-reduced-motion` 降级 |
| `app.js` | 状态机、`localStorage`、`SCENES` 四场景、书库渲染、段落与光标恢复、实时检测与共时便签、归来、语音／电话 |
| `data/library.json` | 12 篇真实散文正文 + 21 条带出处摘句（含《故都的秋》）；「一言」内容源 |
| `assets/scenes/*.webp` | 四张带角色概念图静帧：`moon-garden`（月海花园）、`wind-plain`（风眠浮原）、`cloud-terminal`（云上列车终点站）、`summer-cicada`（夏日蝉鸣） |
| `serve.mjs` | 零依赖静态服务，端口 4180 |

**状态机**：`document.body` 上的 `data-module`（home / chat / writing）、`data-tab`（article / reading）、`data-mode`（companion / immersive）、`data-scene`（四个 key）控制全部界面状态；持久化 key = `jmx-friend-v1`，存 `module / scene / tab / mode / title / doc / fontSize / done / lastEditAt / leaveAt / lastStuck / excerpts / chat / quoteCursor / lastSuggestAt / caret / currentWork`。

**现有按钮／入口清单**（不擅自增减）：`data-go` = home / chat / writing；`data-tab` = article / reading；`data-mode` = companion / immersive；`data-scene` = 四个场景；另有聊天输入框、发送、语音输入、电话、场景菜单、摘录、一言、出处点回。首页全屏唯一实心按钮是发送。

**关键函数**：`renderShelf` / `renderQuotes` / `renderExcerpts` / `openWork` / `currentParagraph` / `restoreCaret` / `applyScene` / `setMode` / `setModule` / `AI.reply`。

- **接真模型只需替换 `AI.reply()`**（`app.js` 顶部注释也写明）；目前是本地陪伴脚本，不代笔、引用可逐字回查。
- 语音输入／电话走浏览器原生 `SpeechRecognition`（含 `webkit` 前缀）与 `SpeechSynthesis`，需要浏览器授权，未做服务端兜底。
- 场景切换、归来按离开时长、实时检测触发的共时便签、18–38s 不定时建议／攀谈，均在 `app.js` 内，无外部依赖。

---

## 七、改代码前必读的硬约束

1. **不使用视频背景**：`app/` 全目录不得出现 `<video>` / `.mp4` / `.webm`；旧视频路径保持 404。场景只用静帧 WebP + CSS 3–5s 环境呼吸 + reduced-motion 降级。
2. **不代笔**：AI 只给建议、想法、攀谈、不同意，不替作者落字。
3. **引用逐字可回查**：每条摘句／一言带出处，出处点回阅读原文。
4. **「一言」原样保留**。
5. **四场景自由切换**，角色只存在于底图里，不再单独做身体层／锚点／痕迹层／立绘。
6. **按钮种类与功能清单不擅自增减**；沉浸模式三层全关、纯白满屏，靠落差表达「两种打扰权限」。
7. 纸面宽度收窄为 800（阅读亦 800），右侧留场景使人物的脸不被遮住；改版式时留意这一条。
8. 改完必须过：`node --check`、HTTP 检查、`jsdom` 交互回归（本机 Chrome headless 静默失败、`mcp__browser` 截图超 10MiB，故用 jsdom 做 DOM／交互回归，最后一次 23/23 PASS、运行时错误 0）。

---

## 八、当前状态与验证记录（截至 `285789c`）

- 工作区干净，本地与远端 HEAD 一致；远端 tree 已含 `app/` 全部 10 项（含 4 张 WebP）。
- HTTP 8/8 200；`assets/videos/courtyard.mp4` 404；四 `.scene-bg` / 四 `.scene-choice` / 四 CSS 底图 / 四 `SCENES` key 一致；锚位与视频引用无残留。
- `node --check` 通过；`jsdom` 回归 23/23 PASS、运行时错误 0；离线合成过首页＋陪伴屏预览确认人物清晰、文字可读（未做真实浏览器截图）。
- **未做视觉走查**：接手人第一次改视觉，请务必在真实浏览器里看一眼 `http://127.0.0.1:4180/`，jsdom 查不出「灰蒙蒙」这类问题。

---

## 九、待办

### 语音通话与文字聊天记忆互通
- [ ] 同一账号、同一对话共享上下文。拨号时读取该对话近期历史，通话双方的转写写回同一条云端对话，挂断后文字聊天可以接着聊。
- [ ] 验证文字 → 通话、通话 → 文字、挂断重拨和跨设备续聊。同步时按消息去重，保持账号和不同对话间的隔离。

### P0 · 寒辞 23:30 提出、当轮被中断，**尚未实施**
1. 界面「看着灰蒙蒙的不大对劲」→ 去灰、提亮，调整场景 scrim / 纸面对比。
2. 按钮「不如放在侧边」→ 由顶部改为侧边。
3. 按钮图案「按照我们这个世界观去重新画一下，总得有个按钮」→ 重画图标，形式 **图标＋文字** 或 **纯图标**。

> 这三条是他的原话，不要替换成自认为更合理的方案；按钮种类与功能清单不因改版式而增减。

### 待寒辞拍板（此前方案里提出、他未确认，不要当作已定）
- 「探索」模块的设计与排期（当前明确「暂时先不设计」）。
- 真模型接入、长期记忆「可查 / 可纠 / 可删」的深化、跨会话「归来」的日记化。
- 人物设定 CANDIDATE 定稿。
- 桌宠 / Live2D / 透明 HEVC / 桌面壳等 P1 路线（当前明确不做角色锚点）。

### 明确不做
视频背景、角色立绘 / 锚点 / 桌宠、AI 代笔、擅自增删一级入口。

---

## 十、接手检查清单

1. `git status --short` 应为空；`git log --oneline -3` 应见 `285789c`。
2. `cd app && node serve.mjs`，打开 `http://127.0.0.1:4180/` 做一次视觉走查。
3. 逐条读第二节「已定判断」，尤其 10 / 11 / 12 三条硬约束。
4. 从第九节 P0 三项开始，改一项验一项（node --check + jsdom + 浏览器看一眼）。
5. 提交信息用中文短句；`git push` 失败按第三节的网络坑重试或走 API 兜底。
