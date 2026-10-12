# Oh My Life

单用户、移动优先的生活记录 PWA，支持无凭证和离线记录。IndexedDB 保存本地业务数据，Cloudflare R2 保存云端快照和图片；同步由用户主动触发。

## 快速开始

```bash
pnpm install
pnpm dev
```

## 部署

项目通过 Cloudflare Workers Static Assets 托管。构建后必须使用仓库中的
`wrangler.jsonc` 部署，确保 `/records`、`/settings` 等前端路由直接访问或刷新时
回退到 `index.html`：

```bash
pnpm build
pnpm dlx wrangler deploy
```

## 开发验证

提交前按[开发验证](docs/开发验证.md)运行本地回归与生产构建。该文档也包含离线检查步骤和真实 R2 冒烟的运行方式。

## 文档入口

新开发者按以下顺序阅读：

1. [仓库协作规则](AGENTS.md)
2. [领域术语与不变规则](CONTEXT.md)
3. [当前产品与运行架构](docs/设计文档.md)
4. [架构决策](docs/adr/)
5. [S3/R2 存储格式](docs/cloud-storage-format.md)
6. [开发验证](docs/开发验证.md)

早期讨论、已完成票据和一次性交付记录不保留在仓库中；临时文件按[票据规则](docs/agents/issue-tracker.md)处理。

## 代码结构

- `src/app/`：应用壳、路由、页面和应用生命周期单例。
- `src/design-system/`：Chakra 主题与通用 UI 组合。
- `src/features/`：全部业务代码，按记录、类型模板、云端、本地存储、偏好和通知聚合；接口与具体实现放在所属业务能力内。
- `src/utils/`：不含业务语义的通用工具，目前只有固定 UTC+8 的时间换算。
- `tests/`：外部行为和核心纯函数测试。

S3/R2 桶内不上传 README 或其他说明文件，桶内格式只由项目内的 [存储格式文档](docs/cloud-storage-format.md) 解释。
