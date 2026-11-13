# 行走云端图库

首批 36 张已逐张看图筛选的摄影作品，来自开源项目 https://github.com/DMarby/picsum-photos 的公开目录。摄影作品原始来源为 Unsplash；图片使用 Unsplash License，不能将项目代码的 MIT 许可当成图片许可。

- 云数据库：`/var/lib/xingzou/app.db`，`image_assets` 保存作者、来源、许可、标签、尺寸、摘要、可用状态；`image_import_runs` 保存最近采集结果。
- 图片文件：`/var/lib/xingzou/images/files/`，由本站 `/media/library/<id>.jpg` 提供；发布更新不覆盖该目录。
- 已审查素材 `ready`，新采集素材 `pending`；只有 `ready` 且文件存在才会进入 `/api/images`。
- 每天北京时间 04:20 后 10 分钟内执行 `xingzou-images.timer`，一次最多 12 张，总量上限 600 张。限制大小、超时、错误次数，记录来源；按来源 ID 和文件 SHA256 去重。采集不读取文章、收藏或用户信息。
- 采集源失败时保留全部既有图片；手机不依赖图片源即时可用。
- 首批图片按主题关键词匹配；同批避免重复，优先避开最近 12 次使用的图片。无匹配时显示纯文字。详情保留摄影作者、来源页和许可链接，明确“非原作插图”。
- Openverse 在线接口与 StockSnap 下载端本次连通性未通过，未作为生产依赖。

## 查看定时执行情况

`systemctl status xingzou-images.timer`，`journalctl -u xingzou-images.service`。

## 后续筛选

新图先进入待筛选区。人工查看画面后，在服务器 manifest 对相应记录填写准确的 `tags`、`title`、`alt`、`reviewedAt`，用经过筛选的独立目录与 manifest 调用 `image_library.py --db ... --folder ...`。导入前会校验文件哈希和来源。未经筛选的图片不会自动混入正式页面。

停用图片只需将其数据库状态改为 `disabled`，保留文件以便回溯。定时采集不会重启用该图片。数据库由现有每日任务备份，图库文件另保留当前压缩快照。
