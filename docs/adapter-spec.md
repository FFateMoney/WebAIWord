# WebAIWord 适配层详细规范

> 本文档详细描述 `src/adapters/aiword-to-canvas.js` 的设计规范，包括 canvas-editor 与 word_ast ai_view 的数据格式、完整字段映射表，以及双向转换算法。
>
> **适配层是整个 WebAIWord 项目最核心的工程难点。** 任何格式的添加、修改都应先更新本文档，再修改代码。

---

## 目录

1. [canvas-editor 数据格式](#1-canvas-editor-数据格式)
2. [word_ast ai_view 数据格式](#2-word_ast-ai_view-数据格式)
3. [完整字段映射表](#3-完整字段映射表)
4. [段落标题样式映射](#4-段落标题样式映射)
5. [aiwordToCanvas 转换规范](#5-aiwordtocanvas-转换规范)
6. [canvasToAiword 转换规范](#6-canvastoaiword-转换规范)
7. [换行与分段算法](#7-换行与分段算法)
8. [表格处理策略](#8-表格处理策略)
9. [图片处理策略](#9-图片处理策略)
10. [id 保留策略](#10-id-保留策略)
11. [单元测试规范](#11-单元测试规范)
12. [待办 / TODO](#12-待办--todo)

---

## 1. canvas-editor 数据格式

`canvas-editor` 通过 `editor.getValue()` / `editor.setValue()` 接口交换文档数据，格式为扁平化的 `Element` 数组。

### 1.1 顶层结构

```typescript
interface CanvasEditorDocument {
  main: Element[];    // 正文内容
  header: Element[];  // 页眉（暂不使用）
  footer: Element[];  // 页脚（暂不使用）
}
```

### 1.2 Element 结构

`Element` 是 canvas-editor 的最小内容单元，对应一段连续样式相同的文本：

```typescript
interface Element {
  // 内容
  value: string;          // 文本内容，换行用 "\n" 表示段落结束

  // 文本样式（可选，省略时使用默认值）
  bold?: boolean;         // 加粗，默认 false
  italic?: boolean;       // 斜体，默认 false
  underline?: boolean;    // 下划线，默认 false
  strikeout?: boolean;    // 删除线，默认 false
  size?: number;          // 字体大小（半磅），默认 16（即 8pt）
  color?: string;         // 文字颜色，CSS 颜色字符串，如 "#FF0000"
  highlight?: string;     // 高亮背景色，CSS 颜色字符串
  font?: string;          // 字体名称，如 "Arial"

  // 段落样式（对整段生效，通常只设在换行符 "\n" 所在的 Element 上）
  rowFlex?: 'left' | 'center' | 'right' | 'stretch';  // 对齐方式

  // 特殊类型（暂不处理）
  type?: 'IMAGE' | 'TABLE' | 'HYPERLINK' | 'DATE' | ...;
}
```

### 1.3 示例

```json
{
  "main": [
    { "value": "一级标题", "bold": true, "size": 32, "rowFlex": "center" },
    { "value": "\n", "rowFlex": "center" },
    { "value": "这是正文第一段，包含", "size": 16 },
    { "value": "加粗文字", "size": 16, "bold": true },
    { "value": "和普通文字。", "size": 16 },
    { "value": "\n" },
    { "value": "这是正文第二段。", "size": 16 },
    { "value": "\n" }
  ],
  "header": [],
  "footer": []
}
```

**关键特性：**
- 段落以 `{ value: '\n' }` 结束，不是以 `<br>` 或 `\r\n`
- 同一段落内的不同样式片段，用多个 `Element` 表示，不插入 `\n`
- 段落级属性（如对齐）可以设在段落内任意 Element 上，也可以只设在 `\n` Element 上
- 数组是**完全扁平的**，没有段落层级嵌套

---

## 2. word_ast ai_view 数据格式

`ai_view` 是 AIWord 库 `to_ai_view()` 函数的输出格式，用于与 AI 模型交互。

> ⚠️ 注意：`full_ast`（`parse_docx()` 的输出）含有 `_raw_*` 字段，**绝对不能发给 AI，也不能传入适配层**。适配层只处理 `ai_view`。

### 2.1 顶层结构

```typescript
interface AiView {
  document: {
    meta: {
      page: {
        width: number;    // 页面宽度（EMU 单位，1 英寸 = 914400 EMU）
        height: number;   // 页面高度
      };
    };
    styles: Record<string, StyleDef>;  // 命名样式定义（通常为空对象）
    body: Block[];                     // 正文块数组
  };
}
```

### 2.2 Paragraph（段落块）

```typescript
interface ParagraphBlock {
  type: 'Paragraph';
  id: string;           // 唯一标识，如 "b0"、"b1"，merge_ai_edits 用于匹配段落
  style: string;        // 段落样式名，如 "Normal"、"Heading1"、"Heading2"
  alignment: 'left' | 'center' | 'right' | 'justify';  // 对齐方式
  content: Run[];       // 文本 run 数组
}

interface Run {
  text: string;         // 文本内容
  bold: boolean;        // 加粗
  italic: boolean;      // 斜体
  size: number;         // 字体大小（半磅）
  color: string | null; // 文字颜色，null 表示默认色
  font_ascii: string | null;  // 英文字体名，null 表示默认字体
}
```

### 2.3 示例

```json
{
  "document": {
    "meta": {
      "page": { "width": 12240, "height": 15840 }
    },
    "styles": {},
    "body": [
      {
        "type": "Paragraph",
        "id": "b0",
        "style": "Heading1",
        "alignment": "center",
        "content": [
          {
            "text": "一级标题",
            "bold": true,
            "italic": false,
            "size": 32,
            "color": null,
            "font_ascii": "Arial"
          }
        ]
      },
      {
        "type": "Paragraph",
        "id": "b1",
        "style": "Normal",
        "alignment": "left",
        "content": [
          { "text": "这是正文第一段，包含", "bold": false, "italic": false, "size": 16, "color": null, "font_ascii": null },
          { "text": "加粗文字", "bold": true, "italic": false, "size": 16, "color": null, "font_ascii": null },
          { "text": "和普通文字。", "bold": false, "italic": false, "size": 16, "color": null, "font_ascii": null }
        ]
      },
      {
        "type": "Paragraph",
        "id": "b2",
        "style": "Normal",
        "alignment": "left",
        "content": [
          { "text": "这是正文第二段。", "bold": false, "italic": false, "size": 16, "color": null, "font_ascii": null }
        ]
      }
    ]
  }
}
```

---

## 3. 完整字段映射表

### 3.1 Run 级字段映射（ai_view → canvas-editor）

| ai_view Run 字段 | 类型 | canvas-editor Element 字段 | 类型 | 转换规则 |
|---|---|---|---|---|
| `run.text` | `string` | `element.value` | `string` | 直接映射 |
| `run.bold` | `boolean` | `element.bold` | `boolean` | `false` 时省略 |
| `run.italic` | `boolean` | `element.italic` | `boolean` | `false` 时省略 |
| `run.size` | `number` | `element.size` | `number` | 直接映射（单位相同：半磅） |
| `run.color` | `string \| null` | `element.color` | `string \| undefined` | `null` → 省略该字段 |
| `run.font_ascii` | `string \| null` | `element.font` | `string \| undefined` | `null` → 省略该字段 |
| _(无对应)_ | — | `element.underline` | `boolean` | ai_view 不含下划线，忽略 |
| _(无对应)_ | — | `element.strikeout` | `boolean` | ai_view 不含删除线，忽略 |

### 3.2 Run 级字段映射（canvas-editor → ai_view）

| canvas-editor Element 字段 | 类型 | ai_view Run 字段 | 类型 | 转换规则 |
|---|---|---|---|---|
| `element.value` | `string` | `run.text` | `string` | 直接映射（排除 `\n`） |
| `element.bold` | `boolean \| undefined` | `run.bold` | `boolean` | `undefined` → `false` |
| `element.italic` | `boolean \| undefined` | `run.italic` | `boolean` | `undefined` → `false` |
| `element.size` | `number \| undefined` | `run.size` | `number` | `undefined` → `16`（默认值） |
| `element.color` | `string \| undefined` | `run.color` | `string \| null` | `undefined` → `null` |
| `element.font` | `string \| undefined` | `run.font_ascii` | `string \| null` | `undefined` → `null` |

### 3.3 段落级字段映射

| ai_view Paragraph 字段 | canvas-editor 字段 | 说明 |
|---|---|---|
| `block.alignment` | `element.rowFlex`（段落内各 Element） | 见对齐映射表 |
| `block.style` | 影响 run 的 `size` 和 `bold` 默认值 | 见标题样式映射表（第 4 节） |
| `block.id` | _(无对应)_ | 仅用于 id 保留策略（第 10 节） |
| `block.type` | _(由段落内容推断)_ | 当前只支持 `"Paragraph"` |

### 3.4 对齐方式映射

| ai_view `alignment` | canvas-editor `rowFlex` | 说明 |
|---|---|---|
| `"left"` | `"left"` | 左对齐（默认） |
| `"center"` | `"center"` | 居中 |
| `"right"` | `"right"` | 右对齐 |
| `"justify"` | `"stretch"` | 两端对齐 |
| _(反向)_ `"left"` | `undefined` / `"left"` | `undefined` 视为左对齐 |

---

## 4. 段落标题样式映射

当 ai_view 中 `block.style` 为标题样式，且 run 未显式设置 `size` 时，按下表设置默认值。

> **优先级**：`run.size` 显式值 > 标题样式推断值 > 全局默认值（16）

| ai_view `block.style` | 推断 `size`（半磅） | 推断 `bold` | 对应 Word 标题级别 |
|---|---|---|---|
| `"Heading1"` | `32` | `true` | 一级标题（约 16pt） |
| `"Heading2"` | `28` | `true` | 二级标题（约 14pt） |
| `"Heading3"` | `24` | `true` | 三级标题（约 12pt） |
| `"Heading4"` | `20` | `true` | 四级标题（约 10pt） |
| `"Title"` | `36` | `true` | 文档标题 |
| `"Subtitle"` | `24` | `false` | 副标题 |
| `"Normal"` | `16` | `false` | 正文（默认） |
| _(其他)_ | `16` | `false` | 按正文处理 |

**反向推断（canvas → ai_view）**：`canvasToAiword` 不反向推断 `style`，直接从 `originalAiView` 的对应位置继承 `style` 字段。若无对应段落，默认为 `"Normal"`。

---

## 5. aiwordToCanvas 转换规范

### 5.1 函数签名

```typescript
function aiwordToCanvas(aiView: AiView): CanvasEditorDocument
```

### 5.2 算法步骤

```
输入：aiView（ai_view JSON 对象）
输出：{ main: Element[], header: [], footer: [] }

1. elements = []
2. 遍历 aiView.document.body 中的每个 block：
   a. 若 block.type !== 'Paragraph'：跳过（TODO：表格、图片）
   b. 根据 block.style 查表，获取 styleSize 和 styleBold（见第 4 节）
   c. 遍历 block.content 中的每个 run：
      i. 构造 Element：
         - value = run.text
         - bold = run.bold（若为 false 且 styleBold 也为 false，可省略）
         - italic = run.italic（若为 false，可省略）
         - size = run.size（若与 styleSize 相同，可省略；建议始终写入保证精度）
         - color = run.color（若为 null，省略）
         - font = run.font_ascii（若为 null，省略）
         - rowFlex = alignmentMap[block.alignment]（设在第一个 run 上即可）
      ii. 将 Element 追加到 elements
   d. 追加换行 Element：{ value: '\n', rowFlex: alignmentMap[block.alignment] }
3. 返回 { main: elements, header: [], footer: [] }
```

### 5.3 边界情况处理

| 情况 | 处理方式 |
|---|---|
| `block.content` 为空数组 | 仅追加 `{ value: '\n' }`，表示空段落 |
| `run.text` 为空字符串 | 追加 `{ value: '' }`，保留 run（可能有格式信息） |
| `run.text` 包含换行符 `\n` | 将 run 按 `\n` 拆分为多个 Element，**不建议 AI 生成含换行的 run** |
| `block.style` 未知 | 按 `"Normal"` 处理 |
| `block.alignment` 为 null | 默认 `"left"` |
| `aiView.document.body` 为空 | 返回 `{ main: [], header: [], footer: [] }` |

### 5.4 代码示例（参考实现）

```javascript
const ALIGNMENT_MAP = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'stretch',
};

const HEADING_STYLE_MAP = {
  Heading1: { size: 32, bold: true },
  Heading2: { size: 28, bold: true },
  Heading3: { size: 24, bold: true },
  Heading4: { size: 20, bold: true },
  Title:    { size: 36, bold: true },
  Subtitle: { size: 24, bold: false },
  Normal:   { size: 16, bold: false },
};

export function aiwordToCanvas(aiView) {
  const elements = [];
  const body = aiView?.document?.body ?? [];

  for (const block of body) {
    if (block.type !== 'Paragraph') continue;

    const styleDefaults = HEADING_STYLE_MAP[block.style] ?? HEADING_STYLE_MAP.Normal;
    const rowFlex = ALIGNMENT_MAP[block.alignment] ?? 'left';

    for (const run of block.content) {
      const el = { value: run.text };
      if (run.bold !== undefined ? run.bold : styleDefaults.bold) el.bold = true;
      if (run.italic) el.italic = true;
      el.size = run.size ?? styleDefaults.size;
      if (run.color) el.color = run.color;
      if (run.font_ascii) el.font = run.font_ascii;
      el.rowFlex = rowFlex;
      elements.push(el);
    }

    elements.push({ value: '\n', rowFlex });
  }

  return { main: elements, header: [], footer: [] };
}
```

---

## 6. canvasToAiword 转换规范

### 6.1 函数签名

```typescript
function canvasToAiword(
  canvasData: CanvasEditorDocument,
  originalAiView?: AiView
): AiView
```

- `originalAiView`：可选，提供原始 ai_view 用于继承段落 `id` 和 `style`。
- 若 `originalAiView` 为 `undefined`，所有段落使用自动生成的 id 和 `"Normal"` style。

### 6.2 算法步骤

```
输入：canvasData, originalAiView
输出：ai_view JSON 对象

1. elements = canvasData.main
2. originalBody = originalAiView?.document?.body ?? []
3. body = []
4. currentRuns = []
5. paraIndex = 0
6. currentRowFlex = 'left'  // 当前段落的对齐方式

7. 遍历 elements 中的每个 el：
   a. 若 el.value === '\n'：
      i. 从 originalBody[paraIndex] 继承 id 和 style（若存在）
      ii. 构造 ParagraphBlock：
          - type = 'Paragraph'
          - id = originalBody[paraIndex]?.id ?? `b${paraIndex}`
          - style = originalBody[paraIndex]?.style ?? 'Normal'
          - alignment = reverseAlignmentMap[el.rowFlex ?? currentRowFlex] ?? 'left'
          - content = currentRuns
      iii. 将 ParagraphBlock 追加到 body
      iv. currentRuns = []，paraIndex++，currentRowFlex = 'left'
   b. 否则（普通文本 Element）：
      i. 若 el.rowFlex 不为 undefined，更新 currentRowFlex = el.rowFlex
      ii. 构造 Run：
          - text = el.value ?? ''
          - bold = el.bold ?? false
          - italic = el.italic ?? false
          - size = el.size ?? 16
          - color = el.color ?? null
          - font_ascii = el.font ?? null
      iii. 将 Run 追加到 currentRuns

8. 若 currentRuns 不为空（文档末尾无 \n）：
   按步骤 7.a 处理剩余 runs，追加最后一个段落

9. 返回：
   {
     document: {
       meta: originalAiView?.document?.meta ?? { page: { width: 12240, height: 15840 } },
       styles: originalAiView?.document?.styles ?? {},
       body,
     }
   }
```

### 6.3 边界情况处理

| 情况 | 处理方式 |
|---|---|
| `canvasData.main` 为空数组 | 返回空 body 的 ai_view |
| 文档末尾无 `\n` | 将剩余 runs 作为最后一个段落，style 为 `"Normal"` |
| 段落数量 > `originalBody` 长度 | 超出部分 id 使用 `"new_0"`, `"new_1"` 等（避免与原始 id 冲突） |
| `el.value` 含换行符（非段落结束符） | 将换行符替换为空格；参考实现需在处理 `else` 分支时添加：`text: (el.value ?? '').replace(/\n/g, ' ')` |
| `el.type` 为非文本类型 | 跳过（TODO：表格、图片） |

### 6.4 代码示例（参考实现）

```javascript
const REVERSE_ALIGNMENT_MAP = {
  left: 'left',
  center: 'center',
  right: 'right',
  stretch: 'justify',
};

export function canvasToAiword(canvasData, originalAiView) {
  const elements = canvasData?.main ?? [];
  const originalBody = originalAiView?.document?.body ?? [];
  const body = [];
  let currentRuns = [];
  let paraIndex = 0;
  let currentRowFlex = 'left';
  let newParaCount = 0;

  for (const el of elements) {
    if (el.value === '\n') {
      const originalPara = originalBody[paraIndex];
      const id = originalPara
        ? originalPara.id
        : paraIndex < originalBody.length
          ? `b${paraIndex}`
          : `new_${newParaCount++}`;

      body.push({
        type: 'Paragraph',
        id,
        style: originalPara?.style ?? 'Normal',
        alignment: REVERSE_ALIGNMENT_MAP[el.rowFlex ?? currentRowFlex] ?? 'left',
        content: currentRuns,
      });
      currentRuns = [];
      paraIndex++;
      currentRowFlex = 'left';
    } else {
      if (el.rowFlex) currentRowFlex = el.rowFlex;
      currentRuns.push({
        text: (el.value ?? '').replace(/\n/g, ' '),
        bold: el.bold ?? false,
        italic: el.italic ?? false,
        size: el.size ?? 16,
        color: el.color ?? null,
        font_ascii: el.font ?? null,
      });
    }
  }

  if (currentRuns.length > 0) {
    const originalPara = originalBody[paraIndex];
    body.push({
      type: 'Paragraph',
      id: originalPara?.id ?? `b${paraIndex}`,
      style: originalPara?.style ?? 'Normal',
      alignment: REVERSE_ALIGNMENT_MAP[currentRowFlex] ?? 'left',
      content: currentRuns,
    });
  }

  return {
    document: {
      meta: originalAiView?.document?.meta ?? { page: { width: 12240, height: 15840 } },
      styles: originalAiView?.document?.styles ?? {},
      body,
    },
  };
}
```

---

## 7. 换行与分段算法

### 7.1 ai_view 到 canvas-editor 的分段

- ai_view 中每个 `Paragraph` block 对应 canvas-editor 中若干 `Element`（run 内容）加一个 `{ value: '\n' }`。
- 段落内的多个 run 不插入任何分隔符，连续排列。
- 示例（1 个含 3 个 run 的段落 → 4 个 Element）：

```
ai_view Paragraph（3个run）  →  [Element, Element, Element, { value:'\n' }]
```

### 7.2 canvas-editor 到 ai_view 的分段

- 遇到 `{ value: '\n' }` 则结束当前段落，将此前积累的 runs 作为该段落的 `content`。
- 未被 `\n` 分隔的连续 Element 属于同一段落。
- 示例（4 个 Element，含 1 个 `\n`）：

```
[Element, Element, Element, { value:'\n' }]  →  Paragraph（content: 3个run）
```

### 7.3 硬换行（Shift+Enter）

Word 中的硬换行（`<w:br/>`）在 canvas-editor 中的表示方式不同于段落分隔符。

> **当前版本不支持硬换行**，遇到硬换行时按普通段落分隔处理。后续版本可参考 canvas-editor 的 `type: 'BR'` Element。

### 7.4 连续空段落

连续的空段落（`content: []`）在 canvas-editor 中表示为连续的 `{ value: '\n' }`：

```javascript
// ai_view：两个空段落
[
  { type: 'Paragraph', id: 'b5', content: [] },
  { type: 'Paragraph', id: 'b6', content: [] },
]

// canvas-editor：两个连续换行
[
  { value: '\n' },
  { value: '\n' },
]
```

---

## 8. 表格处理策略

> ⚠️ **当前版本不支持表格**，以下为未来实现的规划。

### 8.1 ai_view 表格格式（规划）

```json
{
  "type": "Table",
  "id": "t0",
  "rows": [
    {
      "cells": [
        {
          "paragraphs": [
            { "type": "Paragraph", "id": "t0_r0_c0_b0", "content": [{ "text": "表头1" }] }
          ]
        }
      ]
    }
  ]
}
```

### 8.2 适配策略

- `aiwordToCanvas`：将表格转换为 canvas-editor 的 `type: 'TABLE'` Element（格式 TBD）。
- `canvasToAiword`：从 canvas-editor 的 TABLE Element 重建 ai_view 表格结构。
- **当前版本处理方式**：遇到 `type: 'Table'` 的 block 时，跳过，并在 UI 上显示"表格内容暂不支持编辑"提示。

---

## 9. 图片处理策略

> ⚠️ **当前版本不支持图片**，以下为未来实现的规划。

### 9.1 ai_view 图片格式（规划）

```json
{
  "type": "Image",
  "id": "img0",
  "width": 5000,
  "height": 3000,
  "description": "示意图",
  "_ref": "media/image1.png"
}
```

### 9.2 适配策略

- 图片二进制数据由 Pyodide Worker 提取，以 `base64` 或 `Blob URL` 形式传给主线程。
- canvas-editor 使用 `type: 'IMAGE'` Element，`value` 设为图片 URL。
- **当前版本处理方式**：遇到 `type: 'Image'` 的 block 时，插入占位符 Element `{ value: '[图片]' }`。

---

## 10. id 保留策略

`id` 字段在 AIWord 的 `merge_ai_edits()` 中用于匹配 `full_ast` 与 `ai_view` 中的段落，因此适配层必须尽量保留 id。

### 10.1 策略详述

| 场景 | id 处理方式 |
|---|---|
| 导入文档，ai_view → canvas | id 不进入 canvas-editor，保留在 `currentAiView` 内存中 |
| 更新到 AI，canvas → ai_view | 按段落顺序从 `originalAiView` 继承对应位置的 id |
| AI 修改减少了段落数量 | 对应位置 id 继承原 id，多余的原 id 丢弃 |
| AI 修改增加了段落数量 | 超出部分使用 `"new_0"`, `"new_1"` 等 id |
| AI 直接修改 id 字段 | 保留 AI 给出的 id（AI 可能有意重排段落） |
| 导出 .docx 时 | `merge_ai_edits` 用 id 匹配，`"new_*"` id 视为新增段落 |

### 10.2 id 冲突风险

若用户在 canvas-editor 中手动新增段落，再更新到 AI，新增段落的 id 会使用 `"new_N"` 临时 id。这些段落在 `merge_ai_edits` 中会被视为新增，可能导致格式继承不完整。

**建议**：将此风险记录在用户文档中，提示用户"手动新增的段落格式可能与原文档不完全一致"。

---

## 11. 单元测试规范

适配层的双向转换**必须**编写单元测试，覆盖以下场景：

### 11.1 测试分组

```
aiwordToCanvas 测试：
  ✓ 单段落单 run 转换
  ✓ 单段落多 run 转换（含加粗、斜体混合）
  ✓ 多段落转换，含空段落
  ✓ 标题段落（Heading1~4）字体大小推断
  ✓ 对齐方式映射（left/center/right/justify）
  ✓ color 为 null 时不设置字段
  ✓ font_ascii 为 null 时不设置字段
  ✓ 空 body 返回空 main 数组

canvasToAiword 测试：
  ✓ 单段落（含 \n 结束）
  ✓ 多段落
  ✓ 末尾无 \n 的容错处理
  ✓ id 从 originalAiView 继承
  ✓ 段落数量增加时 id 生成（new_0 等）
  ✓ 段落数量减少时多余 id 丢弃
  ✓ 对齐方式反向映射
  ✓ 空 main 数组返回空 body

往返一致性测试：
  ✓ aiwordToCanvas(canvasToAiword(X)) ≈ X（近似，允许省略字段的差异）
  ✓ canvasToAiword(aiwordToCanvas(X)) ≈ X（同上）
```

### 11.2 测试文件位置

```
src/adapters/
├── aiword-to-canvas.js
└── __tests__/
    └── aiword-to-canvas.test.js
```

---

## 12. 待办 / TODO

- [ ] **表格双向转换实现**：canvas-editor `TABLE` Element ↔ ai_view `Table` block
- [ ] **图片支持**：图片提取、Base64 传输、canvas-editor `IMAGE` Element ↔ ai_view `Image` block
- [ ] **页眉/页脚映射**：canvas-editor `header`/`footer` ↔ ai_view 页眉/页脚结构
- [ ] **硬换行支持**：canvas-editor `type: 'BR'` Element ↔ ai_view 硬换行标记
- [ ] **下划线/删除线**：ai_view 扩展 `underline`/`strikeout` 字段后，更新映射表
- [ ] **中文字体映射**：`run.font_eastAsia` 字段（中文字体）到 canvas-editor 的映射
- [ ] **列表样式**：有序/无序列表（`ListParagraph` style）的适配
- [ ] **文字颜色格式标准化**：ai_view 颜色格式（如 `"FF0000"` 无 `#`）与 CSS 颜色格式的互转
- [ ] **字符间距/行距**：ai_view 中的间距字段到 canvas-editor 的映射
- [ ] **性能优化**：大文档（>100 段落）的转换性能 benchmark
