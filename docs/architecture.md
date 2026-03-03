# WebAIWord 完整架构设计文档

> 本文档描述基于 Pyodide + canvas-editor 的纯前端 AIWord Web UI 的完整架构设计。

---

## 目录

1. [整体架构](#1-整体架构)
2. [仓库目录结构](#2-仓库目录结构)
3. [核心数据结构](#3-核心数据结构)
4. [六个核心操作的数据流](#4-六个核心操作的数据流)
5. [适配层设计](#5-适配层设计最重要)
6. [Pyodide Worker 设计](#6-pyodide-worker-设计)
7. [AI 服务设计](#7-ai-服务设计)
8. [状态管理](#8-状态管理)
9. [UI 布局设计](#9-ui-布局设计)
10. [部署方案](#10-部署方案)
11. [技术风险与应对](#11-技术风险与应对)
12. [待办 / TODO](#12-待办--todo)

---

## 1. 整体架构

WebAIWord 的架构分为四个层次，从下至上依次为：

```
┌─────────────────────────────────────────────────────────┐
│                    外部 AI API 层                        │
│         OpenAI API / Claude API / 自定义代理             │
└────────────────────────┬────────────────────────────────┘
                         │ fetch SSE（浏览器直连）
┌────────────────────────▼────────────────────────────────┐
│                   前端 UI 层（主线程）                    │
│   canvas-editor（左栏）  ·  AI 对话面板（右栏）          │
│   工具栏 · 状态管理 · UI 控制器（main.js）               │
└──────────┬──────────────────────────┬───────────────────┘
           │ postMessage              │ 双向格式转换
┌──────────▼──────────┐  ┌───────────▼───────────────────┐
│  Pyodide Web Worker │  │      适配层（adapters/）       │
│  pyodide.worker.js  │  │   aiword-to-canvas.js          │
│  - parse_docx()     │  │   aiwordToCanvas()             │
│  - to_ai_view()     │  │   canvasToAiword()             │
│  - merge_ai_edits() │  └───────────────────────────────┘
│  - render_ast()     │
└──────────┬──────────┘
           │ Pyodide 虚拟文件系统
┌──────────▼──────────────────────────────────────────────┐
│               Python 核心层（Pyodide 沙箱）              │
│   AIWord 库：parse_docx / to_ai_view /                  │
│              merge_ai_edits / render_ast                 │
│   依赖：lxml（Pyodide 内置包）、python-docx（micropip） │
└─────────────────────────────────────────────────────────┘
```

**各层职责：**

- **Python 核心层**：在 Pyodide 沙箱中运行 AIWord 库，负责 `.docx` 的底层解析与渲染。与上层通过 Pyodide Worker 消息隔离，完全不接触 DOM。
- **适配层**：纯 JS 模块，负责 `ai_view` JSON ↔ canvas-editor JSON 的双向格式转换，是整个项目最核心的工程难点。
- **前端 UI 层**：主线程，包含 canvas-editor 编辑器、AI 对话面板、工具栏，以及全局状态管理。
- **外部 AI API 层**：浏览器直接 fetch OpenAI / Claude API，通过 SSE 获取流式输出；API Key 仅存 localStorage，绝不上传服务器。

---

## 2. 仓库目录结构

```
WebAIWord/
├── index.html                  # 应用入口 HTML
├── package.json                # 依赖声明（canvas-editor、vite）
├── vite.config.js              # Vite 构建配置
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 自动部署
├── public/
│   └── word_ast/               # AIWord Python 源码（静态资源）
│       ├── __init__.py
│       ├── parser.py
│       ├── ai_view.py
│       ├── merger.py
│       └── renderer.py
├── docs/
│   ├── architecture.md         # 本文档
│   ├── data-flow.md            # 数据流图
│   └── adapter-spec.md         # 适配层详细规范
└── src/
    ├── main.js                 # 主线程入口，UI 控制器
    ├── style.css               # 全局样式
    ├── workers/
    │   └── pyodide.worker.js   # Pyodide Web Worker（独立线程）
    ├── services/
    │   ├── pyodideService.js   # Worker 通信封装（promise 化）
    │   ├── aiService.js        # AI API 调用（支持 SSE 流式）
    │   └── storageService.js   # localStorage 读写封装
    └── adapters/
        └── aiword-to-canvas.js # 双向格式转换适配层（核心）
```

**关键设计决策：**
- `public/word_ast/` 下的 Python 源码作为静态资源，构建后复制到 `dist/word_ast/`，供 Pyodide Worker 通过 `fetch` 加载。
- Web Worker 与主线程完全隔离，Pyodide 初始化在 Worker 内部完成，不阻塞 UI 渲染。

---

## 3. 核心数据结构

WebAIWord 中流转的 JSON 数据分为两种格式，开发时必须严格区分：

### 3.1 `full_ast`（完整 AST）

- **来源**：`parse_docx()` 的返回值
- **特征**：包含 `_raw_*` 字段，保存原始 XML 片段，用于精确重建 `.docx`
- **用途**：存于 JS 内存，传给 `merge_ai_edits()` 用于合并 AI 修改后渲染为 `.docx`
- ⚠️ **`full_ast` 绝对不能发给 AI**，因为 `_raw_*` 字段体积巨大，且含有与内容无关的排版细节

```json
{
  "document": {
    "meta": { "page": { "width": 12240, "height": 15840 } },
    "styles": { "Normal": { "_raw_style": "<w:style ...>...</w:style>" } },
    "body": [
      {
        "type": "Paragraph",
        "id": "b0",
        "style": "Heading1",
        "alignment": "left",
        "_raw_pPr": "<w:pPr>...</w:pPr>",
        "content": [
          {
            "text": "标题",
            "bold": true,
            "italic": false,
            "size": 28,
            "color": null,
            "font_ascii": "Arial",
            "_raw_rPr": "<w:rPr>...</w:rPr>"
          }
        ]
      }
    ]
  }
}
```

### 3.2 `ai_view`（AI 视图）

- **来源**：`to_ai_view(full_ast)` 的返回值
- **特征**：精简语义字段，去除所有 `_raw_*` 字段
- **用途**：发给 AI 模型，以及在适配层与 canvas-editor 互转
- ✅ **只有 `ai_view` 才能发给 AI**

```json
{
  "document": {
    "meta": { "page": { "width": 12240, "height": 15840 } },
    "styles": {},
    "body": [
      {
        "type": "Paragraph",
        "id": "b0",
        "style": "Heading1",
        "alignment": "left",
        "content": [
          {
            "text": "标题",
            "bold": true,
            "italic": false,
            "size": 28,
            "color": null,
            "font_ascii": "Arial"
          }
        ]
      }
    ]
  }
}
```

### 3.3 canvas-editor JSON

- **来源**：`canvas-editor` 实例的 `getValue()` / `setValue()` 接口
- **特征**：扁平化的 Element 数组，换行用 `\n` 分隔，无段落层级结构

```json
{
  "main": [
    { "value": "标题\n", "bold": true, "size": 28, "font": "Arial" },
    { "value": "正文第一段内容\n", "bold": false, "size": 16 },
    { "value": "正文第二段内容\n", "bold": false, "size": 16 }
  ],
  "header": [],
  "footer": []
}
```

---

## 4. 六个核心操作的数据流

### 4.1 导入 .docx

用户点击「导入 .docx」按钮，从本地文件系统读取 Word 文档并渲染到编辑器。

```
用户选择文件
  └→ File API (input[type=file])
       └→ FileReader.readAsArrayBuffer()
            └→ Uint8Array（二进制文件内容）
                 └→ pyodideService.parse(uint8array)
                      └→ [postMessage] → pyodide.worker.js
                           └→ pyodide.FS.writeFile('/tmp/input.docx', bytes)
                                └→ Python: parse_docx('/tmp/input.docx')
                                     └→ full_ast（含 _raw_*）
                                          └→ Python: to_ai_view(full_ast)
                                               └→ ai_view JSON
                                                    └→ [postMessage 返回主线程]
                                                         ├→ full_ast → 存 JS 内存 (window.fullAst)
                                                         ├→ ai_view → 存 JS 内存 (window.currentAiView)
                                                         └→ aiwordToCanvas(ai_view)
                                                              └→ canvas-editor.setValue(canvasData)
```

### 4.2 更新到 AI（左→右）

用户在编辑器中修改内容后，点击「更新到 AI」将最新内容同步到 AI 上下文。

```
用户点击「更新到 AI」
  └→ canvas-editor.getValue()
       └→ canvasData（canvas-editor JSON）
            └→ canvasToAiword(canvasData, currentAiView)
                 └→ updatedAiView（保留原始 id 字段）
                      ├→ currentAiView = updatedAiView（更新内存状态）
                      └→ chatHistory 注入系统消息：
                         "[文档已更新] 当前文档内容：<ai_view JSON>"
```

### 4.3 发送给 AI

用户在右栏输入框输入修改需求并发送。

```
用户输入消息并点击发送
  └→ chatHistory.push({ role: 'user', content: userMessage })
       └→ aiService.chat(chatHistory, { provider, apiKey, model })
            └→ 构建请求体：
               {
                 "model": "gpt-4o",
                 "messages": chatHistory,  ← 含 system prompt + 文档内容
                 "stream": true
               }
                 └→ fetch(apiEndpoint, { method: 'POST', body: ... })
                      └→ SSE 流式响应解析
                           └→ 逐 token 追加到 AI 消息气泡（流式显示）
                                └→ 流结束后：extractJSON(fullResponse)
                                     └→ 提取 JSON 块（鲁棒解析）
                                          └→ lastAiJson = parsedJson（存内存）
                                               └→ chatHistory.push({ role: 'assistant', content: fullResponse })
```

### 4.4 编译到文档（右→左）

用户点击「编译到文档」，将 AI 返回的 JSON 渲染到左栏编辑器。

```
用户点击「编译到文档」
  └→ lastAiJson（AI 最新返回的 ai_view JSON）
       └→ aiwordToCanvas(lastAiJson)
            └→ canvasData（canvas-editor JSON）
                 └→ canvas-editor.setValue(canvasData)
                      └→ 左栏编辑器显示 AI 修改后的内容
```

> **注意**：此操作不经过 Pyodide，纯 JS 适配层转换。`full_ast` 在此步骤**不更新**，只有「导出 .docx」时才与 AI 修改合并。

### 4.5 导出 .docx

用户点击「导出 .docx」，将当前编辑器内容导出为 Word 文件。

```
用户点击「导出 .docx」
  └→ canvas-editor.getValue()
       └→ canvasData
            └→ canvasToAiword(canvasData, currentAiView)
                 └→ finalAiView（最终 ai_view）
                      └→ pyodideService.render(fullAst, finalAiView)
                           └→ [postMessage] → pyodide.worker.js
                                └→ Python: merge_ai_edits(full_ast, final_ai_view)
                                     └→ mergedAst（合并了 AI 修改的完整 AST）
                                          └→ Python: render_ast(mergedAst)
                                               └→ Uint8Array（.docx 二进制）
                                                    └→ [postMessage 返回主线程]
                                                         └→ new Blob([bytes], { type: 'application/vnd.openxmlformats...' })
                                                              └→ URL.createObjectURL(blob)
                                                                   └→ <a download="output.docx"> 触发浏览器下载
```

### 4.6 Pyodide 初始化

应用启动时，在 Web Worker 中异步初始化 Pyodide 环境。

```
应用启动（main.js）
  └→ new Worker('pyodide.worker.js')
       └→ Worker 内部开始初始化：
            ├→ importScripts('https://cdn.jsdelivr.net/pyodide/vX.Y.Z/full/pyodide.js')
            ├→ loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/vX.Y.Z/full/' })
            ├→ pyodide.loadPackage('lxml')       ← Pyodide 内置包
            ├→ pyodide.loadPackage('micropip')
            ├→ micropip.install('python-docx')   ← PyPI 包
            ├→ fetch('/word_ast/__init__.py')     ← 加载 AIWord 源码
            │   fetch('/word_ast/parser.py')
            │   fetch('/word_ast/ai_view.py')
            │   fetch('/word_ast/merger.py')
            │   fetch('/word_ast/renderer.py')
            ├→ pyodide.FS.mkdir('/word_ast')
            ├→ pyodide.FS.writeFile('/word_ast/__init__.py', ...)
            │   ... （写入各模块文件）
            └→ pyodide.runPython('import word_ast')
                 └→ postMessage({ type: 'ready' }) → 通知主线程初始化完成
                      └→ 主线程隐藏加载进度条，启用工具栏按钮
```

---

## 5. 适配层设计（最重要）

适配层 `src/adapters/aiword-to-canvas.js` 是整个项目最核心的工程难点，负责 `ai_view` JSON 与 canvas-editor JSON 之间的双向无损转换。

### 5.1 `aiwordToCanvas(aiView)`

**功能**：将 word_ast 的 `ai_view` 转换为 canvas-editor 可识别的 JSON 格式。

**转换逻辑：**

```javascript
function aiwordToCanvas(aiView) {
  const elements = [];
  const body = aiView.document.body;

  for (const block of body) {
    if (block.type === 'Paragraph') {
      for (const run of block.content) {
        elements.push({
          value: run.text,
          bold: run.bold || false,
          italic: run.italic || false,
          size: run.size || 16,
          color: run.color || undefined,
          font: run.font_ascii || undefined,
          // 对齐方式存在段落级 Element 上
          rowFlex: alignmentMap[block.alignment] || 'left',
        });
      }
      // 段落末尾追加换行符
      elements.push({ value: '\n' });
    }
    // 表格、图片等类型：见 TODO 章节
  }

  return { main: elements, header: [], footer: [] };
}
```

**字段映射表（ai_view → canvas-editor）：**

| ai_view 字段 | canvas-editor 字段 | 备注 |
|---|---|---|
| `run.text` | `element.value` | 直接映射 |
| `run.bold` | `element.bold` | `false` 时可省略 |
| `run.italic` | `element.italic` | `false` 时可省略 |
| `run.size` | `element.size` | 单位：半磅（与 Word 一致） |
| `run.color` | `element.color` | `null` → 不设置（使用默认色） |
| `run.font_ascii` | `element.font` | 仅英文字体名 |
| `block.alignment` | `element.rowFlex` | 见对齐方式映射 |
| 段落末尾 | `{ value: '\n' }` | 换行符分隔段落 |

**对齐方式映射：**

| ai_view `alignment` | canvas-editor `rowFlex` |
|---|---|
| `"left"` | `"left"` |
| `"center"` | `"center"` |
| `"right"` | `"right"` |
| `"justify"` | `"stretch"` |

**标题样式映射（`block.style` → 字体大小 + 加粗）：**

| ai_view `style` | `size` | `bold` | 说明 |
|---|---|---|---|
| `"Heading1"` | `32` | `true` | 一级标题 |
| `"Heading2"` | `28` | `true` | 二级标题 |
| `"Heading3"` | `24` | `true` | 三级标题 |
| `"Heading4"` | `20` | `true` | 四级标题 |
| `"Normal"` | `16` | `false` | 正文 |

> 注：若 `run.size` 已明确设置，优先使用 `run.size`，否则根据 `block.style` 推断。

### 5.2 `canvasToAiword(canvasData, originalAiView)`

**功能**：将 canvas-editor 的 JSON 格式转换回 word_ast 的 `ai_view`，并尽量保留原始段落的 `id` 和 `style` 信息。

**转换逻辑：**

```javascript
function canvasToAiword(canvasData, originalAiView) {
  const elements = canvasData.main;
  const originalBody = originalAiView?.document?.body || [];
  const body = [];
  let currentRuns = [];
  let paraIndex = 0;

  for (const el of elements) {
    if (el.value === '\n') {
      // 遇到换行符，结束当前段落
      const originalPara = originalBody[paraIndex];
      body.push({
        type: 'Paragraph',
        id: originalPara?.id || `b${paraIndex}`,
        style: originalPara?.style || 'Normal',
        alignment: reverseAlignmentMap[el.rowFlex] || 'left',
        content: currentRuns,
      });
      currentRuns = [];
      paraIndex++;
    } else {
      // 普通文本节点，追加到当前段落的 run 列表
      currentRuns.push({
        text: el.value || '',
        bold: el.bold || false,
        italic: el.italic || false,
        size: el.size || 16,
        color: el.color || null,
        font_ascii: el.font || null,
      });
    }
  }

  return {
    document: {
      meta: originalAiView?.document?.meta || {},
      styles: originalAiView?.document?.styles || {},
      body,
    },
  };
}
```

### 5.3 id 保留策略

段落 `id` 字段在 `merge_ai_edits()` 中用于匹配原始段落，因此**必须尽量保留**：

1. **导入文档时**：`ai_view` 中每个段落有唯一 `id`（如 `"b0"`, `"b1"`），`currentAiView` 保存这些 id。
2. **更新到 AI 时**：`canvasToAiword` 根据段落顺序，从 `originalAiView` 中匹配同位置段落的 `id`。
3. **AI 返回 JSON 时**：若 AI 修改了段落顺序或新增/删除段落，id 可能对不上，`merge_ai_edits()` 会降级处理。
4. **id 冲突处理**：若 AI 返回的段落数多于原始段落数，超出部分使用 `"new_0"`, `"new_1"` 等临时 id。

### 5.4 注意事项

- **换行处理**：canvas-editor 中每个 `{ value: '\n' }` 代表一个段落结束，不是硬换行（`\r\n`）。一个段落内的多个 run 之间不插入 `\n`。
- **段落分割**：一个 ai_view `Paragraph` 对应 canvas-editor 中若干 run + 一个 `\n`，两者一一对应。
- **格式继承**：canvas-editor 中同一段落的多个 run 可以有不同的 bold/italic/size，转换时原样保留，不做合并。
- **空段落**：ai_view 中 `content: []` 的空段落，在 canvas-editor 中表示为仅一个 `{ value: '\n' }`。

---

## 6. Pyodide Worker 设计

### 6.1 为什么使用 Web Worker

Pyodide 初始化需要下载约 20-30MB 的 WASM 文件，并执行大量 Python 代码，整个过程可能耗时 20-30 秒。若在主线程执行，会彻底阻塞 UI，导致页面无响应。因此将 Pyodide 放入 Web Worker 独立线程：

- **主线程**不被阻塞，UI 可正常响应，显示加载进度
- **Worker 线程**独占内存空间（约 200MB），不影响主线程 GC
- Pyodide 操作（parse / render）耗时较长，异步 postMessage 不阻塞 UI

### 6.2 Worker 消息协议

主线程与 Worker 通过 `postMessage` 通信，所有消息均为 JSON 对象：

**主线程 → Worker（请求）：**

```javascript
// 解析 .docx
{
  id: 'req_001',       // 请求唯一 ID，用于匹配响应
  action: 'parse',
  payload: {
    docxBytes: Uint8Array  // .docx 文件的二进制内容
  }
}

// 渲染 .docx
{
  id: 'req_002',
  action: 'render',
  payload: {
    fullAst: Object,    // 完整 AST（含 _raw_*）
    aiView: Object      // AI 修改后的 ai_view
  }
}

// 查询初始化状态
{
  id: 'req_000',
  action: 'status'
}
```

**Worker → 主线程（响应）：**

```javascript
// 初始化进度上报
{ type: 'progress', message: '正在加载 Pyodide...', percent: 10 }
{ type: 'progress', message: '正在安装依赖...', percent: 50 }
{ type: 'progress', message: '正在加载 word_ast...', percent: 80 }
{ type: 'ready' }   // 初始化完成

// parse 响应
{
  id: 'req_001',
  type: 'result',
  payload: {
    fullAst: Object,
    aiView: Object
  }
}

// render 响应
{
  id: 'req_002',
  type: 'result',
  payload: {
    docxBytes: Uint8Array
  }
}

// 错误响应
{
  id: 'req_001',
  type: 'error',
  message: 'parse_docx failed: ...'
}
```

### 6.3 word_ast 源码加载方式

AIWord 库的 Python 源码通过以下方式加载到 Pyodide 虚拟文件系统：

```javascript
// pyodide.worker.js 内部
async function loadWordAst(pyodide) {
  const modules = ['__init__', 'parser', 'ai_view', 'merger', 'renderer'];
  pyodide.FS.mkdir('/word_ast');
  
  for (const mod of modules) {
    const resp = await fetch(`/word_ast/${mod}.py`);
    const code = await resp.text();
    pyodide.FS.writeFile(`/word_ast/${mod}.py`, code);
  }
  
  await pyodide.runPythonAsync('import word_ast');
}
```

**关键点**：`/word_ast/` 路径对应 `public/word_ast/`（开发时）或 `dist/word_ast/`（构建后），Vite 会自动复制 `public/` 下的静态资源到构建产物。

### 6.4 初始化流程

```
Worker 启动
  1. importScripts(pyodide CDN)
  2. postMessage({ type: 'progress', message: '加载 Pyodide 运行时...', percent: 10 })
  3. pyodide = await loadPyodide()
  4. postMessage({ type: 'progress', message: '安装 lxml...', percent: 30 })
  5. await pyodide.loadPackage('lxml')
  6. postMessage({ type: 'progress', message: '安装 micropip...', percent: 40 })
  7. await pyodide.loadPackage('micropip')
  8. postMessage({ type: 'progress', message: '安装 python-docx...', percent: 50 })
  9. await pyodide.runPythonAsync("import micropip; await micropip.install('python-docx')")
  10. postMessage({ type: 'progress', message: '加载 word_ast 库...', percent: 70 })
  11. await loadWordAst(pyodide)
  12. postMessage({ type: 'progress', message: '初始化完成', percent: 100 })
  13. postMessage({ type: 'ready' })
  14. 进入消息监听循环
```

---

## 7. AI 服务设计

### 7.1 支持的 Provider

`aiService.js` 通过统一接口支持多个 AI 服务商：

| Provider | API 端点 | 备注 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` | 默认，支持 GPT-4o |
| Claude | `https://api.anthropic.com/v1/messages` | 需要 `anthropic-version` header |
| 自定义 | 用户配置的 Base URL | 支持 OpenAI 兼容格式的代理 |

```javascript
// aiService.js
const PROVIDERS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    buildHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    }),
  },
  claude: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    buildHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
  },
};
```

### 7.2 SSE 流式解析逻辑

```javascript
async function* streamChat(messages, config) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(config.apiKey),
    body: JSON.stringify({ model: config.model, messages, stream: true }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留未完整的行

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // 忽略解析错误，继续处理下一行
      }
    }
  }
}
```

### 7.3 `extractJSON` 鲁棒解析

AI 回复中往往混有说明文字和 Markdown 代码块，`extractJSON` 需要健壮地提取其中的 JSON：

```javascript
function extractJSON(text) {
  // 策略1：提取 ```json ... ``` 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }

  // 策略2：提取第一个完整的 { ... } JSON 对象
  const braceStart = text.indexOf('{');
  if (braceStart !== -1) {
    let depth = 0, i = braceStart;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    try { return JSON.parse(text.slice(braceStart, i + 1)); } catch {}
  }

  // 策略3：整体尝试解析
  try { return JSON.parse(text.trim()); } catch {}

  return null; // 解析失败
}
```

### 7.4 多轮对话 `chatHistory` 管理

```javascript
// 初始 chatHistory 结构
let chatHistory = [
  { role: 'system', content: SYSTEM_PROMPT }
];

// 注入文档内容（点击「更新到 AI」时）
function injectDocument(aiView) {
  // 找到上一条文档注入消息并移除，避免重复
  chatHistory = chatHistory.filter(m => !m._isDocumentInjection);
  chatHistory.push({
    role: 'user',
    content: `当前文档内容如下（JSON 格式，请基于此进行修改）：\n\`\`\`json\n${JSON.stringify(aiView, null, 2)}\n\`\`\``,
    _isDocumentInjection: true,  // 内部标记，不发给 AI
  });
}

// 重置对话（换文档时）
function resetChat() {
  chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
  lastAiJson = null;
}
```

**重置时机**：用户重新导入 `.docx` 时，调用 `resetChat()` 清空对话历史，避免旧文档内容混入新对话。

### 7.5 System Prompt 设计要点

```
你是一个专业的 Word 文档编辑助手。用户会给你一份文档的 JSON 表示（ai_view 格式），
你需要根据用户的修改要求，返回修改后的完整 JSON。

重要规则：
1. 必须返回完整的 ai_view JSON，不得省略任何段落
2. 尽量保留每个段落的 id 字段不变
3. 新增段落使用 "new_0", "new_1" 等 id
4. 只修改用户要求修改的部分，其他内容保持不变
5. 在 JSON 前后可以有简短说明，但 JSON 必须完整且合法
6. JSON 用 ```json ... ``` 代码块包裹
```

---

## 8. 状态管理

WebAIWord 采用简单的全局变量管理状态，无需引入状态管理框架：

| 变量 | 类型 | 存储位置 | 说明 |
|------|------|---------|------|
| `fullAst` | `Object` | JS 内存（全局变量） | 含 `_raw_*` 字段的完整 AST，**绝对不发给 AI** |
| `currentAiView` | `Object` | JS 内存（全局变量） | 当前文档的 `ai_view`，适配层转换的基准 |
| `lastAiJson` | `Object` | JS 内存（全局变量） | AI 最近一次返回的 JSON，用于「编译到文档」 |
| `chatHistory` | `Array` | JS 内存（全局变量） | 多轮对话历史，含 system prompt |
| `apiKey` | `string` | `localStorage` | API Key，持久化，应用启动时读取 |
| `provider` | `string` | `localStorage` | AI 服务商（`openai` / `claude` / `custom`） |
| `baseUrl` | `string` | `localStorage` | 自定义 Base URL（可选） |
| `model` | `string` | `localStorage` | 模型名称（如 `gpt-4o`） |
| `pyodideReady` | `boolean` | JS 内存 | Pyodide 是否初始化完成 |

**关键约束**：
- `fullAst` 只在 Pyodide Worker 的 `parse` 和 `render` 操作之间传递，主线程存储但不展示、不打印
- `apiKey` 永远不离开浏览器，不发送到除 AI API 以外的任何服务器

---

## 9. UI 布局设计

### 9.1 整体布局

```
┌─────────────────────────────────────────────────────────┐
│  工具栏                                                   │
│  [导入.docx] [导出.docx] [更新到AI] [编译到文档] [API Key]│
├──────────────────────────┬──────────────────────────────┤
│                          │                              │
│   左栏：canvas-editor    │   右栏：AI 对话面板          │
│   （Word 文档编辑器）    │   ┌────────────────────┐    │
│                          │   │ system: 文档已导入  │    │
│   A4 纸张尺寸            │   │ user: 请修改标题    │    │
│   分页模式               │   │ ai: 已修改，JSON:.. │    │
│   富文本编辑             │   └────────────────────┘    │
│                          │   ┌────────────────────┐    │
│                          │   │ 输入框...    [发送] │    │
│                          │   └────────────────────┘    │
└──────────────────────────┴──────────────────────────────┘
```

### 9.2 工具栏按钮说明

| 按钮 | 触发操作 | 禁用条件 |
|---|---|---|
| 导入 .docx | 打开文件选择器，触发「导入」流程 | Pyodide 未就绪 |
| 导出 .docx | 触发「导出」流程，下载文件 | 未导入文档 |
| 更新到 AI | 同步编辑器内容到 AI 上下文 | 未导入文档 |
| 编译到文档 | 将 `lastAiJson` 渲染到编辑器 | `lastAiJson` 为空 |
| API Key | 打开 API Key 配置模态框 | 无 |

### 9.3 左栏：canvas-editor 配置

```javascript
const editor = new CanvasEditor('#canvas-editor-container', {
  width: 794,          // A4 宽度（96dpi，像素）
  height: 1123,        // A4 高度
  mode: 'page',        // 分页模式
  defaultType: 'TEXT',
  // ... 其他配置
});
```

### 9.4 右栏：AI 对话面板

消息类型及渲染方式：

| `role` | 气泡样式 | 说明 |
|---|---|---|
| `user` | 右对齐，蓝色背景 | 用户输入 |
| `assistant` | 左对齐，灰色背景，支持 Markdown | AI 回复（流式追加） |
| `system` | 居中，黄色背景，小字 | 系统提示（如"文档已更新"） |

### 9.5 API Key 模态框

模态框字段：
- Provider 下拉选择（OpenAI / Claude / 自定义）
- API Key 输入框（密码类型，不明文显示）
- Base URL 输入框（Provider 为自定义时显示）
- 模型名称输入框（默认 `gpt-4o`）
- 保存 / 取消按钮

---

## 10. 部署方案

### 10.1 本地开发

```bash
npm install
npm run dev
# 访问 http://localhost:5173
```

Vite 开发服务器会自动处理 `public/word_ast/` 的静态文件服务。

**注意**：开发时需要设置 Worker 的 MIME type，Vite 默认支持，无需额外配置。

### 10.2 构建

```bash
npm run build
# 产物在 dist/ 目录
```

Vite 构建时会自动：
1. 打包 JS 模块到 `dist/assets/`
2. 复制 `public/` 下的静态资源（含 `word_ast/` Python 源码）到 `dist/`

### 10.3 GitHub Pages 自动部署

`.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

**关键构建注意事项**：
- `vite.config.js` 中需要设置 `base: '/WebAIWord/'`（仓库名作为子路径）
- `word_ast` Python 源码需要在 `public/word_ast/` 目录下，构建后自动复制到 `dist/word_ast/`，供 Worker `fetch` 请求

### 10.4 Vite 配置关键项

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/WebAIWord/',  // GitHub Pages 子路径
  worker: {
    format: 'es',       // ES Module Worker
  },
  optimizeDeps: {
    exclude: ['@hufe921/canvas-editor'],  // 避免预构建问题
  },
});
```

---

## 11. 技术风险与应对

| 风险 | 描述 | 严重程度 | 应对方案 |
|------|------|---------|---------|
| **Pyodide 首次加载慢** | 首次加载约 20-30 秒，包含 WASM 下载 | 中 | 加载进度条 + 浏览器缓存（Service Worker 可选）|
| **canvas-editor 格式适配** | 双向转换有损，复杂样式可能丢失 | 高 | 适配层编写完整单元测试，逐步扩充字段支持 |
| **AI 返回 JSON 不稳定** | AI 回复混有说明文字，或 JSON 格式错误 | 高 | `extractJSON` 多策略鲁棒解析，解析失败时提示用户 |
| **内存占用高** | Pyodide 运行时约占用 200MB 内存 | 中 | Web Worker 隔离，不影响主线程；提示用户使用桌面浏览器 |
| **CORS 限制** | 部分 AI API 可能限制跨域请求 | 中 | 支持自定义代理 Base URL，用户可自行搭建 CORS 代理 |
| **大文件解析慢** | 大型 .docx（>5MB）解析可能耗时较长 | 低 | Worker 内异步执行，UI 显示处理中状态 |
| **mobile 兼容性** | canvas-editor 在移动端表现可能不佳 | 低 | 不针对移动端优化，说明文档注明 |

---

## 12. 待办 / TODO

以下功能尚未设计，留待后续版本实现：

- [ ] **表格支持**：`ai_view` 中 `type: "Table"` 块的适配层转换
- [ ] **图片支持**：`ai_view` 中图片块的提取、展示与重建
- [ ] **页眉/页脚编辑**：canvas-editor 的 header/footer 区域与 `ai_view` 的映射
- [ ] **目录（TOC）**：自动目录的生成与更新
- [ ] **脚注/尾注**：footnote/endnote 的适配
- [ ] **CRDT 协同编辑**：多人实时协同编辑（需要后端或 CRDT 算法）
- [ ] **Service Worker 缓存**：Pyodide WASM 离线缓存，加快二次加载
- [ ] **撤销/重做**：与 AI 修改集成的历史记录管理
- [ ] **模板库**：常用文档模板的导入
- [ ] **段落级 AI 修改**：精确到段落级别的 AI 修改，而非整文档替换
