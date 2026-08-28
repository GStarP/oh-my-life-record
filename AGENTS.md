## 重要规则

1. 奥卡姆剃刀：如无必要，勿增实体。优先选择足以解决问题的最简方案，避免引入不必要的复杂度。
2. 文档优先使用中文。
3. 介绍架构、流程等理论性内容时，应该附带示例。
4. 交付时，应该说明：做了什么，对应哪些文件，怎么做的（关键点，不展开细节），如何验证。
5. 测试只写最核心、最有必要的；每个测试用例都必须带有详细、人类可读的注释，说明被测行为、原因与预期。
6. 类型与逻辑分离到不同文件：类型文件命名为 `type.ts` 或以 `.type.ts` 结尾。

## 文件组织

新增、移动或拆分 `src/` 文件前，先读 `docs/adr/0007-feature-module-boundaries.md`。

- 业务代码按业务能力归入 `src/features/`；类型、规则、界面、外部读写接口及其实现与所属 feature 就近放置。`src/app/` 只放应用壳、路由入口和跨 feature 生命周期组装；只有不含业务语义的通用代码才能进入 `src/utils/`。
- Feature 内默认平铺。仅当一组至少 3 个强相关文件形成稳定子能力、通常一起修改，并且父目录调用者无需了解其内部细节时，才建立子目录。
- 子目录使用业务词汇命名（如 `editor`、`list`、`images`、`credential`、`r2`、`sync`），不按 `components`、`hooks`、`models` 等技术角色分类；直接导入真实文件路径，不建立 barrel 文件。

## Agent skills

### Issue tracker

票据以本地 markdown 形式存于 `.scratch/<feature>/issues/`。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个角色标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。
