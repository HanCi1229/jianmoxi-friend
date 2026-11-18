# 笺墨溪 Friend

面向阅读、写作和日常聊天的陪伴应用，包含网页端和 Android 客户端。

## 本地预览

在仓库根目录用 Node.js 20 或更新版本运行：

```sh
npm ci
npm start
```

打开 `http://127.0.0.1:4180/`。聊天和写作的云端功能依赖账号与数据服务，部署默认通过本机 `http://127.0.0.1:8766` 访问，可用 `JIANMOXI_ORIGIN` 指定 HTTPS 服务或本机回环地址。豆包实时通话需要在服务端环境中配置 `FRIEND_DOUBAO_API_KEY`。HTTPS 部署时，设置 `FRIEND_PUBLIC_ORIGIN` 为公开来源，并为实时通话路由启用 WebSocket 转发。

## 项目文件

- [网页端与服务端](app/)
- [Android 源码和打包脚本](android/)
- [Android 安装包](artifacts/android/)
- [壁纸原图与迭代稿](artifacts/wallpapers/)
- [语音试听和参考样本](artifacts/voice-previews/)
- [人物标准](01_人物标准/)及[旧版素材归档](artifacts/archive/)
- [项目交接与待办](HANDOVER.md)，其中包括语音通话与文字聊天的记忆互通。
