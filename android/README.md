# OhMyLife Android

应用标识为 `app.ohmylife.record`。名称显示为 OhMyLife；修改名称不改变包标识或覆盖安装能力。产品与数据行为见 [设计文档](../docs/设计文档.md)。

## 环境与构建

需要 Node.js 24、pnpm、JDK 21 和 Android SDK 36 / Build Tools 36.0.0。设置 `JAVA_HOME`、`ANDROID_HOME`，并通过 Android Studio 或本机 `android/local.properties` 指定 SDK。

```sh
pnpm install
pnpm android:sync
pnpm android:open
```

在 Android Studio 中选择模拟器或手机运行。命令行构建及候选打包：

```sh
pnpm android:build
pnpm android:package
```

- Gradle 调试包：`android/app/build/outputs/apk/debug/app-debug.apk`。
- 下载候选包：`artifacts/OhMyLife-v1.0.0.apk`，旁边保存 SHA-256、签名及源码校验信息。
- 打包不执行 GitHub 发布，审批和稳定下载链接见 [发布流程](../docs/发布.md)。

## 签名与个人使用

个人使用继续提供自动签名的 debug 包，不单独维护 release 构建。网页使用 Vite 生产资源，debug 允许原生和 WebView 调试，可能存在性能开销，不能替代 release 性能测量。

调试签名默认来自 `~/.android/debug.keystore`；保持 `ANDROID_USER_HOME` 和该密钥一致，后续才能覆盖安装。仓库只记录公开证书摘要，私钥及其备份不提交 GitHub。

## 手机安装

1. 将 `OhMyLife-v1.0.0.apk` 传到手机，在文件管理器中打开，按系统提示允许该来源安装。
2. 首次使用可直接离线记录；需要恢复时打开“设置 → 云端配置”，填写端点、Access Key ID、Access Key Secret 和桶名，点击“连接”。凭证不包含在 APK 中。
3. 回记录页手动同步，首次从云端恢复记录、模板和图片。
4. 更新时用同一签名直接覆盖安装，保留当前数据；不要先卸载或清除应用数据。

例如从模拟器切换到手机，先手动备份，再在手机配置同一桶并同步恢复；之后两端各自离线使用，通过手动同步交换整库快照。

## 开发验证

核心、独立模拟器、原生仪器测试和真实 R2 隔离冒烟统一见 [开发验证](../docs/开发验证.md)。
