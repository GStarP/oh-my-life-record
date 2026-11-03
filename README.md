# OhMyLife

仅供个人使用的 Android 生活记录应用。React 界面运行在 Capacitor 壳内，SQLite 和图片文件保存在手机本地；无需云端配置即可离线使用，S3/R2 用于手动备份与恢复。

## 开始开发

需要 Node.js 24、pnpm、JDK 21 和 Android SDK 36。

```sh
pnpm install
pnpm android:sync
pnpm android:open
```

在 Android Studio 中运行模拟器或手机。数据功能通过 Android 原生插件提供。构建、签名和手机安装见 [Android 说明](android/README.md)。

## 验证与打包

```sh
pnpm test
pnpm android:package
```

打包只生成带版本号的本地候选产物。运行 `pnpm release:review` 打开审核页；确认后自动发布，取消则退出。每个版本发布前均须用户明确批准，见 [AGENTS.md](AGENTS.md) 和 [发布流程](docs/发布.md)。

## 文档入口

- [领域术语](CONTEXT.md)：记录、模板、图片和备份的含义。
- [产品与架构](docs/设计文档.md)：模块职责、编辑和同步流程。
- [云端格式](docs/cloud-storage-format.md)：SQLite 快照、图片对象和提交元信息。
- [开发验证](docs/开发验证.md)：核心回归、独立模拟器和真机检查。
- [验收记录](docs/验收记录.md)：验证结果与实际手机体验范围。
- [架构决策](docs/adr/)：长期保留的取舍。

## 代码位置

| 位置 | 职责 |
| --- | --- |
| `src/app/` | 应用壳、路由与生命周期组装 |
| `src/features/` | 记录、类型模板、存储、云端、偏好与通知 |
| `src/design-system/` | Chakra 主题与通用界面组合 |
| `src/utils/` | 无业务语义的时间和时限工具 |
| `android/` | Android 工程、原生数据与图片能力 |
| `tools/` | Android 打包与逐版本审核发布工具 |
| `tests/` | 核心规则、真实 SQLite 与 Android 回归 |

凭证、签名私钥、个人数据备份及构建产物均不提交到仓库。
