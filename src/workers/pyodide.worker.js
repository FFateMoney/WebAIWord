// Pyodide Web Worker — runs in a dedicated thread
// Handles: init, parse, render commands via postMessage

import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs'

let pyodide = null

// List of word_ast files to fetch and write to Pyodide FS
const WORD_AST_FILES = [
  'word_ast/__init__.py',
  'word_ast/ai_view.py',
  'word_ast/ai_merge.py',
  'word_ast/schema.py',
  'word_ast/parser/__init__.py',
  'word_ast/parser/document_parser.py',
  'word_ast/parser/paragraph_parser.py',
  'word_ast/parser/style_parser.py',
  'word_ast/parser/table_parser.py',
  'word_ast/renderer/__init__.py',
  'word_ast/renderer/document_renderer.py',
  'word_ast/renderer/paragraph_renderer.py',
  'word_ast/renderer/style_renderer.py',
  'word_ast/renderer/table_renderer.py',
  'word_ast/renderer/toc_renderer.py',
  'word_ast/utils/__init__.py',
  'word_ast/utils/units.py',
]

function progress(text) {
  self.postMessage({ type: 'progress', text })
}

/**
 * Serialize any thrown value to a plain string so it survives postMessage.
 * Python exceptions from Pyodide may carry non-string .message values or
 * use a Pyodide proxy wrapper, so we guard every coercion.
 * @param {unknown} err
 * @returns {string}
 */
function serializeError(err) {
  try {
    if (typeof err === 'string') return err
    if (err instanceof Error) {
      // String() guards against .message being a Pyodide proxy object
      return err.message ? String(err.message) : err.toString()
    }
    try {
      return JSON.stringify(err)
    } catch (_) {
      return String(err)
    }
  } catch (_) {
    return 'Unknown worker error'
  }
}

async function cmdInit() {
  progress('正在加载 Pyodide 运行时...')
  pyodide = await loadPyodide()

  progress('正在加载 lxml...')
  await pyodide.loadPackage('lxml')

  progress('正在安装 python-docx...')
  await pyodide.loadPackage('micropip')
  await pyodide.runPythonAsync(`
import micropip
await micropip.install('python-docx')
`)

  progress('正在加载 AIWord 模块文件...')
  // Create directory structure in Pyodide FS
  pyodide.FS.mkdir('/word_ast')
  pyodide.FS.mkdir('/word_ast/parser')
  pyodide.FS.mkdir('/word_ast/renderer')
  pyodide.FS.mkdir('/word_ast/utils')
  pyodide.FS.mkdir('/tmp')

  // Fetch each Python file and write to FS
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  for (let i = 0; i < WORD_AST_FILES.length; i++) {
    const relPath = WORD_AST_FILES[i]
    const url = base + '/' + relPath
    progress(`正在加载模块文件 (${i + 1}/${WORD_AST_FILES.length}): ${relPath}`)
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${url}`)
    const text = await resp.text()
    pyodide.FS.writeFile('/' + relPath, text)
  }

  progress('正在导入 AIWord 模块...')
  await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, '/')
import word_ast
`)

  progress('Pyodide 就绪')
}

async function cmdParse({ docxBytes }) {
  // Write docx bytes to virtual FS
  pyodide.FS.writeFile('/tmp/input.docx', docxBytes)

  // Parse and convert to ai_view
  const resultJson = await pyodide.runPythonAsync(`
import json
from word_ast import parse_docx, to_ai_view

full_ast = parse_docx('/tmp/input.docx')
ai_view = to_ai_view(full_ast)
json.dumps({'fullAst': full_ast, 'aiView': ai_view}, ensure_ascii=False)
`)

  return JSON.parse(resultJson)
}

async function cmdRender({ fullAst, aiView }) {
  // Pass data to Python via globals
  pyodide.globals.set('_full_ast_json', JSON.stringify(fullAst))
  pyodide.globals.set('_ai_view_json', JSON.stringify(aiView))

  await pyodide.runPythonAsync(`
import json
from word_ast import merge_ai_edits, render_ast

_full_ast = json.loads(_full_ast_json)
_ai_view = json.loads(_ai_view_json)
_merged = merge_ai_edits(_full_ast, _ai_view)
render_ast(_merged, '/tmp/output.docx')
`)

  const docxBytes = pyodide.FS.readFile('/tmp/output.docx')
  return { docxBytes }
}

self.onmessage = async (event) => {
  const { id, cmd, payload } = event.data
  try {
    let result
    if (cmd === 'init') {
      result = await cmdInit()
    } else if (cmd === 'parse') {
      result = await cmdParse(payload)
    } else if (cmd === 'render') {
      result = await cmdRender(payload)
    } else {
      throw new Error(`Unknown command: ${cmd}`)
    }
    self.postMessage({ id, ok: true, result })
  } catch (err) {
    self.postMessage({ id, ok: false, error: serializeError(err) })
  }
}
