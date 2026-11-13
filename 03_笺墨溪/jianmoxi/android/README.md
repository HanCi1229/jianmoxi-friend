# 笺墨溪 Android 云端客户端

- 版本：0.1.2（2）；包名：`com.xingzou.literary.cloud`，与之前收到的旧应用独立。
- 支持 Android 8.0 及以上，需要较新的 Android System WebView / Chrome。
- 入口固定为 `https://49.234.43.25/`，使用现有访问密码。APK 不包含 API 密钥、密码、数据库或文章。
- 原生部分提供应用图标、系统返回、键盘和安全区适配、加载与连接失败提示、JSON 备份导入、文本和备份导出。页面、AI 和数据仍由现有云端服务提供。
- 仅申请 INTERNET 权限；文件操作由系统选择器授权，不申请整个存储空间的访问权。不忽略 TLS 错误，不允许明文请求。
- 不是离线完整版；首次打开和读取云端文章需要网络。未同步内容仍由网页的暂存与恢复流程处理。

## 构建

从项目根目录运行 `python3 android/build.py`。编译工具存于忽略的 `android-build-tools/`：Amazon Corretto 17 macOS ARM64、Google Android SDK Platform 35 r02、Build Tools 35.0.0。SDK 压缩包已与 Google 官方仓库 SHA-1 核对；无额外 Java 库。

输出 `releases/jianmoxi-0.1.2.apk` 及 SHA-256 文件。首次构建生成专用签名文件 `.deploy/android-signing.p12` 和密码文件 `.deploy/android-signing.pass`，权限 600。两者必须私下保存，之后升级沿用同一签名并增加 versionCode，不要放入 APK 或公开下载目录。

签名证书 SHA-256：`af401353d46b23e01acdc3b9bbdcca74adcf32b0bdf3d8a90e921dd04143f4a1`。

## 本次验证

- Java 编译、DEX 转换、APK 对齐和 v2/v3 签名验证通过。
- 清单已核对：启动 Activity、Android 8.0 最低版本、仅 INTERNET 权限、禁止备份和明文流量。
- 云端下载文件与本地 SHA-256 一致；服务器 HTTPS 健康检查通过。
- 当前没有连接安卓手机，也没有安装模拟器；尚未在 Android 上验收实际安装、键盘、文件选择器和返回交互。

## 下载

公开安装包地址：`https://49.234.43.25/downloads/jianmoxi-0.1.2.apk`。公开下载只包含已签名的应用，不包含私人配置。安装包连接的是当前试用服务器，服务器到期或关闭后，应用的云端功能也会受影响。


## 0.1.2 阅读选区操作

- 正文长按继续由 WebView 建立文字选区和拖动手柄；通过 [ActionMode.Callback2](https://developer.android.com/reference/android/view/ActionMode.Callback2) 包装创建/更新回调，清空整个系统菜单，保留 Chromium 的原回调和销毁逻辑。
- 仅在可信云端页面、网页阅读工具就绪且触摸目标属于 `.library-reader .prose` 时启用；标题、写作正文、搜索和其他编辑框保持原有复制/剪切/粘贴/全选。原生 `EDIT_TEXT_TYPE` 另作保护。
- 网页通过仅接受布尔值的 `XingzouReader` 通知就绪/触摸区域，不传输文本、不提供剪贴板或文件读写。
- 版本号递增、包名及签名不变，支持覆盖安装。已完成编译、签名和清单检查；当前没有连接真机，实际系统菜单和视觉验收由用户完成。
