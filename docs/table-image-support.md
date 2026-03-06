# 表格与图片支持落地指南

本文给出在 WebAIWord 中新增“表格 + 图片”支持的最小可行实现路径，覆盖解析、适配、编辑、AI 往返与导出全链路。

## 1. 当前限制（为什么现在不可用）

1. 前端编辑态只抽取 Paragraph，`Table`/`Image` 不进入可编辑视图。
2. `src/adapters/aiword-to-canvas.js` 仅处理 Paragraph + Text run，非文本节点被跳过。
3. 现有 Patch 系统默认面向段落 id，缺少单元格/图片节点的稳定定位约定。

## 2. 推荐实现顺序（先可用，再完善）

### 阶段 A：先实现“可见 + 不丢失”

- 在 `aiwordToCanvas` 中把：
  - `Table` block 渲染为不可编辑占位块（含 `blockId`）
  - `InlineImage` run 渲染为图片元素（含 `width/height`）
- 在 `canvasToAiword` 中识别对应占位元素并还原为 AST 节点。
- 当编辑器不支持原生 TABLE/IMAGE 元素时，使用“只读占位 + 元数据映射”兜底。

### 阶段 B：实现“结构化可编辑”

- Table：建立 cell 级路径映射（`t0.r1.c2.p0`）。
- Image：支持替换图片（保留尺寸）与改描述。
- Patch 扩展操作：
  - `update_table_cell`
  - `replace_image`
  - `insert_row` / `delete_row`

### 阶段 C：增强一致性

- 增加 round-trip 测试（导入→编辑→导出→再导入 diff）。
- 增加冲突策略（AI 改表格同时用户本地也改）。

## 3. 关键代码改造点

### 3.1 `src/services/aiViewSchema.js`

- 放宽 `extractParagraphBlocks`：新增 `extractEditableBlocks`，保留 `Paragraph/Table/Image`。
- `mergeParagraphsIntoAiView` 升级为 `mergeEditableBlocksIntoAiView`，按 block id 合并。

### 3.2 `src/adapters/aiword-to-canvas.js`

- `aiwordToCanvas(aiView)`：
  - 新增 `Table` 分支（转 TABLE 元素或占位元素）
  - 新增 `InlineImage` 分支（转 IMAGE 元素）
- `canvasToAiword(canvasData, originalAiView)`：
  - 新增 TABLE/IMAGE 反向还原分支
  - 对无法识别的元素保留到 `passthrough`

### 3.3 `src/main.js`

- `buildEditableAiView` 改为基于“可编辑块”而非仅 Paragraph。
- “更新到 AI”前把表格/图片块也写回 canonical ai_view。
- 编译失败时，提示具体 block id（例如 `t3` 或 `img2`）。

### 3.4 Patch 协议（`docs/patch-protocol.md`）

- 补充表格/图片操作定义、字段约束、错误码。
- 增加示例：修改单元格文本、替换图片。

## 4. 数据结构建议（可直接采用）

### 4.1 Table（ai_view）

```json
{
  "type": "Table",
  "id": "t0",
  "rows": [
    {
      "cells": [
        {
          "id": "t0.r0.c0",
          "paragraphs": [
            {
              "type": "Paragraph",
              "id": "t0.r0.c0.p0",
              "style": "Normal",
              "paragraph_format": { "alignment": "left" },
              "content": [{ "type": "Text", "text": "表头1" }]
            }
          ]
        }
      ]
    }
  ]
}
```

### 4.2 InlineImage（run）

```json
{
  "type": "InlineImage",
  "data": "<base64>",
  "content_type": "image/png",
  "width": 2400,
  "height": 1400,
  "description": "示意图"
}
```

## 5. 测试清单（必须补齐）

1. 解析：含 2 个表格 + 3 张图 docx 是否完整进入 ai_view。
2. 前端显示：导入后表格/图片是否可见。
3. 编辑：单元格文字修改后是否可导出并在 Word 打开正常。
4. AI：`replace_image`、`update_table_cell` 能否正确应用。
5. 回归：纯段落文档不受影响。

## 6. 风险与建议

- `canvas-editor` 对 TABLE/IMAGE 原生能力如果不足，先使用只读占位方案，确保“不丢内容”优先。
- 图片 base64 可能导致消息体过大，建议在 AI 上下文中只传“图片描述 + 引用 id”，二进制走本地映射。
- 表格 id 必须稳定，建议统一路径式 id（`t{n}.r{n}.c{n}.p{n}`）。
