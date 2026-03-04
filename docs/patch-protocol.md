# AI Patch 协议（aiword.patch.v1）

用于让模型仅输出最小修改，而不是完整 `ai_view` JSON。

## 1. 顶层结构

```json
{
  "protocol": "aiword.patch.v1",
  "operations": []
}
```

- `protocol`：固定为 `aiword.patch.v1`
- `operations`：按顺序执行的操作数组

## 2. 支持的操作

### 2.1 RFC6902 子集

```json
{ "op": "add", "path": "/document/body/1/content/-", "value": { "text": "新增", "bold": false, "italic": false, "size": 16, "color": null, "font_ascii": null } }
{ "op": "replace", "path": "/document/body/0/alignment", "value": "center" }
{ "op": "remove", "path": "/document/body/2/content/0" }
```

- `path` 使用 JSON Pointer
- `add` 支持数组 `-` 作为末尾追加

### 2.2 按段落 ID 的扩展操作

```json
{ "op": "insert_after_id", "target_id": "b3", "value": { "type": "Paragraph", "id": "b3_1", "style": "Normal", "alignment": "left", "content": [] } }
{ "op": "insert_before_id", "target_id": "b3", "value": { "type": "Paragraph", "id": "b2_9", "style": "Normal", "alignment": "left", "content": [] } }
{ "op": "replace_by_id", "target_id": "b3", "value": { "type": "Paragraph", "id": "b3", "style": "Heading2", "alignment": "left", "content": [] } }
{ "op": "update_by_id", "target_id": "b3", "fields": { "alignment": "justify", "style": "Normal" } }
```

> 字段约定：按 ID 的操作请使用 `target_id`。
> 前端为兼容历史输出，也接受 `targetId` / `id` / `target`，但不建议使用。

## 3. 约束建议（Prompt 中已内置）

1. 只输出 JSON，不要解释文本。
2. 只输出必要变更。
3. 不改系统字段：`document.meta`、`id`、`createdAt`、`updatedAt`、`version`。
4. 颜色统一 `#RRGGBB`。

## 4. 回退策略

前端仍兼容旧模式：若 AI 返回完整 `ai_view`，可继续编译，但会提示改用 patch。
