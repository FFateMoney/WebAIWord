# WebAIWord 完整数据流图

> 本文档用 Mermaid 图表详细展示 WebAIWord 的完整数据流，包含文档处理流和 AI 对话流，以及两者的交汇点。

---

## 目录

1. [系统总体数据流](#1-系统总体数据流)
2. [文档处理流：导入 .docx](#2-文档处理流导入-docx)
3. [AI 对话流：发送消息](#3-ai-对话流发送消息)
4. [数据交汇：编译到文档](#4-数据交汇编译到文档)
5. [文档处理流：导出 .docx](#5-文档处理流导出-docx)
6. [Pyodide 初始化流](#6-pyodide-初始化流)
7. [状态流转图](#7-状态流转图)
8. [待办 / TODO](#8-待办--todo)

---

## 1. 系统总体数据流

```mermaid
graph TD
    subgraph 用户操作
        U1[导入 .docx]
        U2[编辑文档]
        U3[更新到 AI]
        U4[发送 AI 消息]
        U5[编译到文档]
        U6[导出 .docx]
    end

    subgraph JS主线程
        CE[canvas-editor<br/>左栏编辑器]
        AI_PANEL[AI 对话面板<br/>右栏]
        STATE[全局状态<br/>fullAst / currentAiView<br/>lastAiJson / chatHistory]
        ADAPTER[适配层<br/>aiword-to-canvas.js]
    end

    subgraph WebWorker
        PW[Pyodide Worker<br/>pyodide.worker.js]
        PYODIDE[Pyodide 运行时<br/>Python 沙箱]
        AIWORD[AIWord 库<br/>parse_docx<br/>to_ai_view<br/>merge_ai_edits<br/>render_ast]
    end

    subgraph 外部服务
        OPENAI[OpenAI API]
        CLAUDE[Claude API]
        CUSTOM[自定义代理]
    end

    U1 -->|File API| PW
    PW --> PYODIDE --> AIWORD
    AIWORD -->|full_ast + ai_view| STATE
    STATE -->|ai_view| ADAPTER
    ADAPTER -->|canvas JSON| CE

    U2 --> CE
    U3 -->|触发| ADAPTER
    ADAPTER -->|更新 ai_view| STATE
    STATE -->|注入文档内容| AI_PANEL

    U4 --> AI_PANEL
    AI_PANEL -->|chatHistory| OPENAI
    AI_PANEL -->|chatHistory| CLAUDE
    AI_PANEL -->|chatHistory| CUSTOM
    OPENAI -->|SSE 流式| AI_PANEL
    AI_PANEL -->|extractJSON| STATE

    U5 -->|lastAiJson| ADAPTER
    ADAPTER -->|canvas JSON| CE

    U6 -->|触发| CE
    CE -->|canvasData| ADAPTER
    ADAPTER -->|finalAiView| PW
    PW --> AIWORD
    AIWORD -->|.docx Blob| U6

    style AIWORD fill:#f9f,stroke:#333
    style ADAPTER fill:#ff9,stroke:#333
    style STATE fill:#9ff,stroke:#333
```

---

## 2. 文档处理流：导入 .docx

```mermaid
sequenceDiagram
    participant User as 用户
    participant UI as 主线程 UI
    participant Adapter as 适配层
    participant Worker as Pyodide Worker
    participant Python as Python (AIWord)

    User->>UI: 点击「导入 .docx」
    UI->>UI: input[type=file].click()
    User->>UI: 选择文件
    UI->>UI: FileReader.readAsArrayBuffer()
    UI->>UI: new Uint8Array(arrayBuffer)
    UI->>Worker: postMessage({ action:'parse', payload:{ docxBytes } })
    Worker->>Worker: pyodide.FS.writeFile('/tmp/input.docx', bytes)
    Worker->>Python: parse_docx('/tmp/input.docx')
    Python-->>Worker: full_ast (含 _raw_* 字段)
    Worker->>Python: to_ai_view(full_ast)
    Python-->>Worker: ai_view (精简语义字段)
    Worker-->>UI: postMessage({ type:'result', payload:{ fullAst, aiView } })
    UI->>UI: window.fullAst = fullAst
    UI->>UI: window.currentAiView = aiView
    UI->>Adapter: aiwordToCanvas(aiView)
    Adapter-->>UI: canvasData
    UI->>UI: editor.setValue(canvasData)
    UI->>User: 文档显示在左栏编辑器中

    Note over Python,Worker: full_ast 含 _raw_* 字段<br/>绝对不能发给 AI！<br/>原因：① _raw_* 体积巨大，超出 token 限制<br/>② 产生不必要的 API 费用<br/>③ 可能泄露文档内部格式细节
```

---

## 3. AI 对话流：发送消息

```mermaid
sequenceDiagram
    participant User as 用户
    participant UI as 主线程 UI
    participant Adapter as 适配层
    participant AIService as aiService.js
    participant API as AI API (OpenAI/Claude)

    User->>UI: 点击「更新到 AI」（可选）
    UI->>UI: editor.getValue() → canvasData
    UI->>Adapter: canvasToAiword(canvasData, currentAiView)
    Adapter-->>UI: updatedAiView
    UI->>UI: currentAiView = updatedAiView
    UI->>UI: 向 chatHistory 注入文档内容消息

    User->>UI: 在右栏输入修改需求并发送
    UI->>UI: chatHistory.push({ role:'user', content:userMessage })
    UI->>AIService: streamChat(chatHistory, config)
    AIService->>API: POST /v1/chat/completions (stream:true)
    API-->>AIService: SSE data: {"choices":[{"delta":{"content":"..."}}]}
    loop 流式 token
        AIService-->>UI: yield token
        UI->>UI: 追加 token 到 AI 气泡（流式显示）
    end
    API-->>AIService: data: [DONE]
    AIService-->>UI: 流结束，返回完整响应文本
    UI->>UI: extractJSON(fullResponse) → lastAiJson
    UI->>UI: chatHistory.push({ role:'assistant', content:fullResponse })
    UI->>User: AI 回复显示在右栏，「编译到文档」按钮激活

    Note over UI,API: chatHistory 中的文档内容<br/>即为 ai_view JSON（非 full_ast）
```

---

## 4. 数据交汇：编译到文档

**编译到文档**是文档处理流与 AI 对话流的交汇点：AI 返回的 JSON 通过适配层渲染到编辑器。

```mermaid
sequenceDiagram
    participant User as 用户
    participant UI as 主线程 UI
    participant Adapter as 适配层

    Note over UI: AI 对话流产出 lastAiJson
    User->>UI: 点击「编译到文档」
    UI->>UI: 检查 lastAiJson 是否存在
    UI->>Adapter: aiwordToCanvas(lastAiJson)
    Adapter-->>UI: canvasData
    UI->>UI: editor.setValue(canvasData)
    UI->>User: 左栏编辑器显示 AI 修改后的内容

    Note over UI,Adapter: 此操作不经过 Pyodide<br/>fullAst 在此步骤不更新<br/>仅在「导出」时才合并
```

---

## 5. 文档处理流：导出 .docx

```mermaid
sequenceDiagram
    participant User as 用户
    participant UI as 主线程 UI
    participant Adapter as 适配层
    participant Worker as Pyodide Worker
    participant Python as Python (AIWord)

    User->>UI: 点击「导出 .docx」
    UI->>UI: editor.getValue() → canvasData
    UI->>Adapter: canvasToAiword(canvasData, currentAiView)
    Adapter-->>UI: finalAiView
    UI->>Worker: postMessage({ action:'render', payload:{ fullAst, aiView:finalAiView } })
    Worker->>Python: merge_ai_edits(full_ast, final_ai_view)
    Python-->>Worker: mergedAst (完整 AST，含 _raw_* + AI 修改)
    Worker->>Python: render_ast(mergedAst)
    Python-->>Worker: docx_bytes (Uint8Array)
    Worker-->>UI: postMessage({ type:'result', payload:{ docxBytes } })
    UI->>UI: new Blob([docxBytes], { type:'application/vnd.openxmlformats...' })
    UI->>UI: URL.createObjectURL(blob)
    UI->>User: 浏览器触发文件下载 output.docx

    Note over Python,Worker: merge_ai_edits 通过 id 字段<br/>匹配 full_ast 与 ai_view 中的段落<br/>保留 _raw_* 字段中的原始格式
```

---

## 6. Pyodide 初始化流

```mermaid
sequenceDiagram
    participant UI as 主线程 UI
    participant Worker as Pyodide Worker
    participant CDN as Pyodide CDN
    participant PyPI as PyPI (micropip)
    participant FS as 虚拟文件系统

    UI->>Worker: new Worker('pyodide.worker.js')
    Worker-->>UI: postMessage({ type:'progress', percent:10, msg:'加载 Pyodide 运行时...' })
    Worker->>CDN: importScripts(pyodide.js)
    CDN-->>Worker: pyodide.js
    Worker->>CDN: loadPyodide() → 下载 pyodide.wasm (~20MB)
    alt CDN 不可用或网络超时
        CDN-->>Worker: 请求失败
        Worker-->>UI: postMessage({ type:'error', message:'Pyodide 加载失败，请检查网络连接' })
        UI->>User: 显示错误提示，禁用所有按钮
    else 加载成功
        CDN-->>Worker: Pyodide 运行时就绪
    end
    Worker-->>UI: postMessage({ type:'progress', percent:30, msg:'安装 lxml...' })
    Worker->>Worker: pyodide.loadPackage('lxml')
    Worker-->>UI: postMessage({ type:'progress', percent:50, msg:'安装 python-docx...' })
    Worker->>PyPI: micropip.install('python-docx')
    alt PyPI 不可用或包安装失败
        PyPI-->>Worker: 安装失败
        Worker-->>UI: postMessage({ type:'error', message:'依赖安装失败：python-docx' })
        UI->>User: 显示错误提示
    else 安装成功
        PyPI-->>Worker: python-docx 安装完成
    end
    Worker-->>UI: postMessage({ type:'progress', percent:70, msg:'加载 word_ast...' })
    Worker->>FS: fetch('/word_ast/__init__.py') → writeFile
    Worker->>FS: fetch('/word_ast/parser.py') → writeFile
    Worker->>FS: fetch('/word_ast/ai_view.py') → writeFile
    Worker->>FS: fetch('/word_ast/merger.py') → writeFile
    Worker->>FS: fetch('/word_ast/renderer.py') → writeFile
    Worker->>Worker: pyodide.runPython('import word_ast')
    Worker-->>UI: postMessage({ type:'progress', percent:100, msg:'初始化完成' })
    Worker-->>UI: postMessage({ type:'ready' })
    UI->>UI: 隐藏进度条，启用工具栏按钮

    Note over CDN,Worker: Pyodide WASM 约 20MB<br/>首次加载约 20-30 秒<br/>浏览器会缓存，二次加载较快
```

---

## 7. 状态流转图

下图展示 WebAIWord 全局状态在各操作中的变化：

```mermaid
stateDiagram-v2
    [*] --> 初始化中 : 应用启动

    初始化中 --> 就绪_无文档 : Pyodide ready

    就绪_无文档 --> 解析中 : 导入 .docx
    解析中 --> 就绪_有文档 : parse 完成\n(fullAst + currentAiView 已存)

    就绪_有文档 --> 就绪_有文档 : 编辑文档\n(canvas-editor 内部状态)

    就绪_有文档 --> AI就绪 : 更新到 AI\n(chatHistory 注入文档)

    AI就绪 --> AI响应中 : 发送 AI 消息
    AI响应中 --> AI就绪_有结果 : 流式完成\n(lastAiJson 已存)

    AI就绪_有结果 --> 就绪_有文档 : 编译到文档\n(editor.setValue)

    就绪_有文档 --> 渲染中 : 导出 .docx
    AI就绪_有结果 --> 渲染中 : 导出 .docx
    渲染中 --> 就绪_有文档 : render 完成\n(触发下载)
    渲染中 --> AI就绪_有结果 : render 完成\n(触发下载)

    就绪_有文档 --> 解析中 : 重新导入 .docx\n(chatHistory 重置)
    AI就绪 --> 解析中 : 重新导入 .docx\n(chatHistory 重置)
    AI就绪_有结果 --> 解析中 : 重新导入 .docx\n(chatHistory 重置)
```

---

## 8. 待办 / TODO

- [ ] **表格数据流**：`type: "Table"` 块从 ai_view → canvas-editor 的详细流程图
- [ ] **图片数据流**：图片二进制数据在 Worker ↔ 主线程之间的传递方式
- [ ] **错误处理流**：Pyodide 异常、AI API 限流、JSON 解析失败等异常路径
- [ ] **Service Worker 缓存流**：Pyodide WASM 的离线缓存策略
- [ ] **段落级 diff 流**：AI 仅修改部分段落时，如何最小化 merge_ai_edits 的改动范围
