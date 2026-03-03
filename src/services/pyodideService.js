/**
 * PyodideService — wraps the Pyodide Web Worker with a Promise-based API.
 * Uses a Map of pending promises keyed by auto-incrementing call id.
 */
export class PyodideService {
  constructor() {
    this._worker = new Worker(new URL('../workers/pyodide.worker.js', import.meta.url), { type: 'module' })
    this._pending = new Map()
    this._nextId = 1
    this._onProgress = null

    this._worker.onmessage = (event) => {
      const msg = event.data
      // Progress messages have no id
      if (msg.type === 'progress') {
        if (this._onProgress) this._onProgress(msg.text)
        return
      }
      const pending = this._pending.get(msg.id)
      if (!pending) return
      this._pending.delete(msg.id)
      if (msg.ok) {
        pending.resolve(msg.result)
      } else {
        pending.reject(new Error(msg.error))
      }
    }

    this._worker.onerror = (err) => {
      // Reject all pending promises on a fatal worker error
      for (const [, pending] of this._pending) {
        pending.reject(new Error(err.message || 'Worker error'))
      }
      this._pending.clear()
    }
  }

  /**
   * Initialize Pyodide. Calls onProgress(text) for each progress update.
   * @param {function(string): void} onProgress
   * @returns {Promise<void>}
   */
  init(onProgress) {
    this._onProgress = onProgress
    return this._call('init', {})
  }

  /**
   * Parse a .docx file. Returns { fullAst, aiView }.
   * @param {Uint8Array} docxBytes
   * @returns {Promise<{fullAst: object, aiView: object}>}
   */
  parse(docxBytes) {
    return this._call('parse', { docxBytes })
  }

  /**
   * Render a merged AST back to .docx bytes.
   * @param {object} fullAst
   * @param {object} aiView
   * @returns {Promise<{docxBytes: Uint8Array}>}
   */
  render(fullAst, aiView) {
    return this._call('render', { fullAst, aiView })
  }

  /**
   * Internal: send a command to the worker and wait for the response.
   * @param {string} cmd
   * @param {object} payload
   * @returns {Promise<any>}
   */
  _call(cmd, payload) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++
      this._pending.set(id, { resolve, reject })
      this._worker.postMessage({ id, cmd, payload })
    })
  }
}
