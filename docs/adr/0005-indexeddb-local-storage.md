# 本地存储引擎：IndexedDB（弃 OPFS / localStorage / DuckDB）

本地存储统一用 IndexedDB：`records`（按 `time` 索引，游标分页实现懒加载）、`images`（仅待上传图片的 Blob，附 createdAt 供孤儿兜底清理，上传成功即删）、`partitionState`（按月同步状态）、`typeTemplates`（类型 → 当前模板）和 `typeTemplateState`（全局模板同步状态）。`StorageAdapter.getImageBlob` 隐藏暂存项元数据。数据库版本固定为 `1`，直接创建全部对象存储，不提供旧结构升级或兼容读取。

- 弃 OPFS：当前数据模型不需要文件系统 API；IndexedDB 已足够支持按记录、同步状态和待上传图片分别存取，兼容面也更直接。
- 弃 localStorage：5MB 硬限制，且单 key 提交 = 全量重写，无法懒加载。
- 弃 DuckDB：本地需与云端月 JSON 结构一致以保持双向可恢复；DB 引入转换层、单点故障与无谓复杂度，v1 查询（按类型筛选、按天分组、游标分页）内存过滤足够。

代价：本地与云端不是同一结构（IDB 表 vs 月 JSON），但 JSON 是交换格式——任一端均可由另一端完整重建（上传 = 生成月 JSON，下载 = 分片替换回 IDB），双向可恢复的闭环属性保持。

## 格式变更

本地数据库与云端 `schemaVersion` 均保持 `1`，格式变更通过清空旧数据重新开始，不迁移或补齐旧字段。例如新增 `name` 后，记录必须包含字符串名称，旧数据通过设置页「清空数据」删除。
