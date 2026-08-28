# S3/R2 存储格式

## 1. 结构

```text
manifest.json
type-templates.json
records/YYYY-MM.json
images/{imageId}.webp
```

- `manifest.json`：月份分片和类型模板集合的版本索引。
- `type-templates.json`：全部类型模板的当前快照。
- `records/YYYY-MM.json`：某个月份的完整记录快照，月份按 UTC+8 计算。
- `images/{imageId}.webp`：图片二进制对象。

## 2. 文件格式

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "partitions": {
    "2026-08": 3
  },
  "typeTemplatesRevision": 2
}
```

- `schemaVersion`：数据格式版本，当前为 `1`。
- `partitions`：`月份 → 版本号`。版本号按月份独立递增。
- `typeTemplatesRevision`：`type-templates.json` 的版本号，必填；尚未上传模板时为 `0`。

### `type-templates.json`

```json
{
  "revision": 2,
  "templates": [
    {
      "type": "记账",
      "icon": "wallet",
      "attributes": [
        { "name": "分类", "kind": "option", "options": ["吃喝", "购物"] },
        { "name": "费用", "kind": "number" }
      ]
    }
  ]
}
```

- `revision`：模板集合版本，必须与 `manifest.json.typeTemplatesRevision` 一致。
- `templates`：类型模板全集；一个 `type` 至多一个模板。
- `icon`：类型模板图标的字符串标识，当前选择器提供 20 个值；旧文件缺少该字段时读取为默认值 `utensils`，已经存储但不再展示在选择器中的旧值仍可正常渲染。
- `attributes[].kind`：`text`、`number`、`boolean` 或 `option`。
- `options`：仅 `option` 使用；为空数组表示没有建议值，但表单仍允许输入任意字符串。

### `records/YYYY-MM.json`

```json
{
  "month": "2026-08",
  "revision": 3,
  "records": [
    {
      "id": "01JEXAMPLE0000000000000000",
      "time": "2026-08-17T08:30:00.000Z",
      "type": "阅读",
      "name": "读完一本书",
      "description": "读后感第一段。\n\n第二段保留完整正文。",
      "images": ["01JIMAGE000000000000000000"],
      "attributes": {
        "页数": 320,
        "完成": true,
        "作者": "示例作者"
      }
    }
  ]
}
```

顶层字段：

- `month`：月份，必须与文件名中的 `YYYY-MM` 一致。
- `revision`：该月份的版本号，必须与 `manifest.json.partitions[month]` 一致；不一致的文件视为损坏，不覆盖本地数据。
- `records`：该月份的全部记录，不是增量列表。

记录字段：

- `id`：记录唯一 ID。
- `time`：ISO 8601 时间字符串，上传时为 UTC 时间。
- `type`：记录类型字符串；自由记录可以为空字符串。
- `name`：简短名称字符串，未填写时为 `""`。字段必填；缺失或非字符串均视为损坏。
- `description`：描述字符串，无描述时为 `""`。
- `images`：图片 ID 数组，无图片时为 `[]`。
- `attributes`：自定义属性对象，值只能是字符串、数值或布尔值；文本或数值属性为空时不写入，布尔属性始终写入；无属性时为 `{}`。

仅接受当前格式，不迁移旧记录（见 [ADR-0005](adr/0005-indexeddb-local-storage.md)）。

### `images/{imageId}.webp`

- `{imageId}` 是图片 ID。
- 对正常可解码、可编码的图片，内容是压缩后的 WebP 二进制数据；极少数浏览器无法处理原始格式时，会保留原始图片二进制，虽然对象名仍使用 `.webp` 后缀。
- 对象的 `Content-Type` 以实际上传 Blob 的类型为准，不能只根据对象名判断编码格式。
- 图片对象不嵌入记录文件，也不保存图片 URL。

## 3. 关联关系

```text
manifest.json
  ├─ typeTemplatesRevision = 2
  │    └─ type-templates.json
  │         └─ templates[].attributes[] → 记录表单录入规则
  └─ partitions["2026-08"] = 3
       └─ records/2026-08.json
            └─ records[i].images[j] = "01JIMAGE..."
                 └─ images/01JIMAGE....webp
```

`manifest.json` 指向模板集合和月份文件的版本；模板只影响表单呈现，不复制进记录。月份文件保存记录；记录的 `images` 数组通过 `imageId` 指向图片对象。同一图片 ID 可以被多条记录引用。
