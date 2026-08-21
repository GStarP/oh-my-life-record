# 本地 Markdown 票据

票据和规格说明是开发过程中的临时文件，按需创建在 `.scratch/` 下；该目录不是最终项目文档。功能完成后，只把最终结论归档到规范的设计文档、ADR 或唯一的交付记录中，不把 `.scratch/` 内容带入最终文档。

## 目录约定

- 一个功能使用一个目录：`.scratch/<feature-slug>/`
- 规格说明：`.scratch/<feature-slug>/spec.md`
- 实现票据：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号，不合并成一个大票据文件
- 票据顶部用 `Status:` 记录状态；可用角色标签见 `triage-labels.md`
- 讨论过程追加在文件底部的 `## Comments` 下

## 发布和读取票据

- 技能要求“发布到票据系统”时，在对应 `.scratch/<feature-slug>/` 下新建文件。
- 技能要求“读取相关票据”时，读取用户给出的路径或票据编号对应的文件。

## Wayfinder 导航约定

如果使用 `/wayfinder`，地图和子票据按以下规则组织：

- 地图：`.scratch/<effort>/map.md`，记录 Notes、Decisions-so-far 和 Fog
- 子票据：`.scratch/<effort>/issues/NN-<slug>.md`，正文写问题，顶部记录 `Type:`（`research` / `prototype` / `grilling` / `task`）和 `Status:`（`claimed` / `resolved`）
- 阻塞关系：用 `Blocked by: NN, NN` 记录；列出的票据全部 `resolved` 后才算解除阻塞
- Frontier：扫描 `issues/`，找出未解决、未阻塞、未认领的票据，按编号最小者优先
- Claim：开始工作前把状态改为 `claimed`
- Resolve：在 `## Answer` 下追加结论、把状态改为 `resolved`，再把结论摘要和链接写回地图的 Decisions-so-far
