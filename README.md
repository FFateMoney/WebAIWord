# WebAIWord

> 零后端、纯浏览器的 AI 辅助 Word 文档编辑器

---

## 项目简介

**WebAIWord** 是一个完全运行在浏览器中的 AI 辅助 Word 文档编辑器。它将 Python 库 [AIWord](https://github.com/FFateMoney/AIWord) 的 `.docx` 解析与渲染能力，通过 [Pyodide](https://pyodide.org/) 搬进浏览器，配合 [canvas-editor](https://github.com/Hufe921/canvas-editor) 提供所见即所得的文档编辑体验，并通过右侧 AI 对话面板直接调用 OpenAI / Claude 等大模型接口，实现"对话式修改 Word 文档"的完整闭环。

整个应用**无需任何后端服务器**，可直接部署到 GitHub Pages。

---

## 核心特性

| 特性 | 说明 |
|------|------|
| 🚫 零后端 | 纯静态文件，可部署到 GitHub Pages / CDN |
| 🐍 浏览器内 Python | 通过 Pyodide 在 Web Worker 中运行 AIWord 核心库 |
| 📝 专业排版 | canvas-editor 提供 A4 分页、富文本编辑 |
| 🤖 多模型支持 | 兼容 OpenAI、Claude 及自定义 Base URL |
| 🔒 隐私安全 | 文件不离开浏览器，API Key 仅存 localStorage |
| 🔄 双向转换 | .docx ↔ canvas-editor ↔ AI JSON 全链路打通 |

---

## 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

> **首次加载需要下载 Pyodide 运行时（约 20-30 秒），请耐心等待进度条完成。**

### 部署到 GitHub Pages

推送到 `main` 分支后，GitHub Actions 会自动构建并部署：

```bash
git push origin main
```

构建产物会发布到 `gh-pages` 分支，可通过 `https://<用户名>.github.io/WebAIWord/` 访问。

### 基本使用流程

1. **导入文档**：点击工具栏「导入 .docx」按钮，选择本地 Word 文件
2. **等待解析**：Pyodide 解析文档，左栏显示可编辑的文档内容
3. **配置 AI**：点击「API Key」设置你的 OpenAI 或 Claude API Key
4. **更新到 AI**：点击「更新到 AI」将当前文档内容同步到右侧 AI 上下文
5. **AI 对话**：在右栏输入修改需求，AI 返回修改后的 JSON
6. **编译到文档**：点击「编译到文档」将 AI 返回结果渲染到左栏编辑器
7. **导出文档**：点击「导出 .docx」下载修改后的 Word 文件

---

## 技术栈

| 层次 | 技术 | 用途 |
|------|------|------|
| Python 核心层 | [AIWord](https://github.com/FFateMoney/AIWord) | .docx 解析、AST 操作、文档渲染 |
| Python 运行时 | [Pyodide](https://pyodide.org/) | 在浏览器内执行 Python |
| 文档编辑器 | [@hufe921/canvas-editor](https://github.com/Hufe921/canvas-editor) | 所见即所得富文本编辑 |
| 构建工具 | [Vite](https://vitejs.dev/) | 前端构建与开发服务器 |
| AI 接口 | OpenAI API / Claude API | 大模型对话 |
| 部署 | GitHub Pages + GitHub Actions | 静态站点托管 |

---

## 文档

- [完整架构设计](./docs/architecture.md) — 整体分层、数据流、各模块设计
- [数据流图](./docs/data-flow.md) — Mermaid 流程图，直观展示完整数据链路
- [适配层规范](./docs/adapter-spec.md) — canvas-editor ↔ AIWord 双向转换详细规范

---

## 项目结构

```
WebAIWord/
├── index.html              # 应用入口
├── package.json
├── vite.config.js
└── src/
    ├── main.js             # 主线程入口，UI 控制器
    ├── workers/
    │   └── pyodide.worker.js   # Pyodide Web Worker
    ├── services/
    │   ├── pyodideService.js   # Worker 通信封装
    │   ├── aiService.js        # AI API 调用（SSE 流式）
    │   └── storageService.js   # localStorage 持久化
    └── adapters/
        └── aiword-to-canvas.js # 双向格式转换适配层
```

---

## 许可证

MIT
