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
 * Serialize any thrown value into a plain JSON-safe object.
 * Handles standard JS Errors, Pyodide PythonErrors, and Emscripten
 * ErrnoError objects (which are plain objects without a .message field).
 */
function serializeError(err) {
  if (err == null) return { name: 'Error', message: 'Unknown error', stack: '' }
  // Always convert .message to a JS string to avoid [object Object]
  // when err is an Emscripten ErrnoError (no message) or a Pyodide proxy.
  const name    = String(err.name    ?? 'Error')
  const message = err.message != null ? String(err.message) : String(err)
  const stack   = err.stack   != null ? String(err.stack)   : ''
  const result  = { name, message, stack }
  // For Pyodide PythonError the message already contains the full Python
  // traceback; expose it explicitly so the main thread can surface it.
  if (name === 'PythonError') result.pythonTraceback = message
  // Surface Emscripten errno/code when present (e.g. FS.mkdir EEXIST)
  if (err.errno != null) result.errno = err.errno
  if (err.code  != null) result.errnoCode = String(err.code)
  return result
}

/**
 * Create a directory in Pyodide's virtual FS, ignoring EEXIST (errno 20).
 * Pyodide pre-mounts /tmp and possibly other dirs, so a plain FS.mkdir
 * would throw an ErrnoError and — because ErrnoError has no .message —
 * the catch block would produce the infamous "[object Object]" error.
 */
function mkdirSafe(path) {
  try {
    pyodide.FS.mkdir(path)
  } catch (e) {
    // errno 20 = EEXIST — directory already exists, that's fine
    if (!(e && e.errno === 20)) throw e
  }
}

async function cmdInit() {
  progress('正在加载 Pyodide 运行时...')
  pyodide = await loadPyodide()
  progress('Pyodide 运行时加载完成，正在加载 lxml 包...')

  await pyodide.loadPackage('lxml')
  progress('lxml 加载完成，正在加载 micropip...')

  await pyodide.loadPackage('micropip')
  progress('micropip 加载完成，正在通过 micropip 安装 python-docx（需要网络）...')

  await pyodide.runPythonAsync(`
import micropip
await micropip.install('python-docx')
`)
  progress('python-docx 安装完成，正在写入 word_ast 模块文件...')

  // Create directory structure in Pyodide FS (safe — tolerates pre-existing dirs)
  mkdirSafe('/word_ast')
  mkdirSafe('/word_ast/parser')
  mkdirSafe('/word_ast/renderer')
  mkdirSafe('/word_ast/utils')
  mkdirSafe('/tmp')

  // Fetch each Python file and write to virtual FS
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  for (const relPath of WORD_AST_FILES) {
    progress(`正在加载 ${relPath}...`)
    const resp = await fetch(base + '/' + relPath)
    if (!resp.ok) throw new Error(`Failed to fetch ${relPath}: ${resp.status}`)
    const text = await resp.text()
    pyodide.FS.writeFile('/' + relPath, text)
  }

  progress('正在导入 word_ast 模块...')
  // Wrap the import so Python tracebacks are preserved in the thrown error
  await pyodide.runPythonAsync(`
import sys, traceback
sys.path.insert(0, '/')
try:
    import word_ast
    from word_ast import parse_docx, render_ast, to_ai_view, merge_ai_edits
except Exception:
    raise RuntimeError(traceback.format_exc())
`)

  progress('Pyodide 就绪')
}

async function cmdParse({ docxBytes }) {
  // Write docx bytes to virtual FS
  pyodide.FS.writeFile('/tmp/input.docx', docxBytes)

  // Parse and convert to ai_view
  const resultJson = await pyodide.runPythonAsync(`
import json, traceback
try:
    from word_ast import parse_docx, to_ai_view
    full_ast = parse_docx('/tmp/input.docx')
    ai_view = to_ai_view(full_ast)
    json.dumps({'fullAst': full_ast, 'aiView': ai_view}, ensure_ascii=False)
except Exception:
    raise RuntimeError(traceback.format_exc())
`)

  return JSON.parse(resultJson)
}

async function cmdRender({ fullAst, aiView }) {
  // Pass data to Python via globals
  pyodide.globals.set('_full_ast_json', JSON.stringify(fullAst))
  pyodide.globals.set('_ai_view_json', JSON.stringify(aiView))

  await pyodide.runPythonAsync(`
import json, traceback
try:
    from word_ast import merge_ai_edits, render_ast
    _full_ast = json.loads(_full_ast_json)
    _ai_view  = json.loads(_ai_view_json)
    _merged   = merge_ai_edits(_full_ast, _ai_view)
    render_ast(_merged, '/tmp/output.docx')
except Exception:
    raise RuntimeError(traceback.format_exc())
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
    // Always serialize the error to a plain object so the main thread
    // never receives a non-clonable value or an empty [object Object].
    self.postMessage({ id, ok: false, error: serializeError(err) })
  }
}
