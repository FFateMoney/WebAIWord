import Editor from '@hufe921/canvas-editor'
import { PyodideService } from './services/pyodideService.js'
import { AIService } from './services/aiService.js'
import { storageService } from './services/storageService.js'
import { aiwordToCanvas, canvasToAiword } from './adapters/aiword-to-canvas.js'

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  pyodide: new PyodideService(),
  ai: new AIService(),
  editor: null,
  fullAst: null,
  currentAiView: null,
  lastAiJson: null,
  chatHistory: [],
}

// ─── DOM refs ───────────────────────────────────────────────────────────────
const progressContainer = document.getElementById('progress-container')
const progressBar        = document.getElementById('progress-bar')
const progressText       = document.getElementById('progress-text')

const btnImport   = document.getElementById('btn-import')
const btnUpdateAI = document.getElementById('btn-update-ai')
const btnCompile  = document.getElementById('btn-compile')
const btnExport   = document.getElementById('btn-export')
const btnApiKey   = document.getElementById('btn-apikey')
const btnSend     = document.getElementById('btn-send')
const chatInput   = document.getElementById('chat-input')
const fileInput   = document.getElementById('file-input')

const modalApiKey   = document.getElementById('modal-apikey')
const btnSaveApiKey = document.getElementById('btn-save-apikey')
const btnCloseModal = document.getElementById('btn-close-modal')
const btnClearCache = document.getElementById('btn-clear-cache')
const selectProvider = document.getElementById('select-provider')
const labelBaseUrl   = document.getElementById('label-baseurl')
const chatMessages   = document.getElementById('chat-messages')

// ─── Progress helpers ────────────────────────────────────────────────────────
function setProgress(percent, text = '') {
  progressBar.style.width = `${percent}%`
  if (text) progressText.textContent = text
}

function hideProgress() {
  progressContainer.classList.add('done')
}

// ─── Enable all toolbar buttons ──────────────────────────────────────────────
function enableToolbar() {
  btnImport.disabled   = false
  btnUpdateAI.disabled = false
  btnCompile.disabled  = false
  btnExport.disabled   = false
  btnApiKey.disabled   = false
  btnSend.disabled     = false
  chatInput.disabled   = false
}

// ─── Chat helpers ────────────────────────────────────────────────────────────
function appendMessage(role, text) {
  const bubble = document.createElement('div')
  bubble.className = `chat-bubble ${role}`
  bubble.textContent = text
  chatMessages.appendChild(bubble)
  chatMessages.scrollTop = chatMessages.scrollHeight
}

// ─── canvas-editor 初始化 ────────────────────────────────────────────────────
const container = document.getElementById('canvas-container')
state.editor = new Editor(
  container,
  { main: [], header: [] },          // 初始空文档
  {
    pageMode: 'paging',              // A4 分页模式
    width: 794,
    height: 1123,
    margins: [100, 120, 100, 120],   // 上右下左 (px)
    zone: {
      tipDisabled: false
    }
  }
)

// ─── API Key 模态框 ───────────────────────────────────────────────────────────
btnApiKey.addEventListener('click', () => {
  // Populate fields from saved config
  const cfg = state.ai.getConfig()
  selectProvider.value = cfg.provider
  document.getElementById('input-apikey').value = cfg.apiKey
  document.getElementById('input-baseurl').value = cfg.baseUrl || ''
  document.getElementById('input-model').value = cfg.model
  labelBaseUrl.classList.toggle('hidden', cfg.provider !== 'custom')
  modalApiKey.classList.remove('hidden')
})
btnCloseModal.addEventListener('click', () => {
  modalApiKey.classList.add('hidden')
})
modalApiKey.addEventListener('click', (e) => {
  if (e.target === modalApiKey) modalApiKey.classList.add('hidden')
})
selectProvider.addEventListener('change', () => {
  labelBaseUrl.classList.toggle('hidden', selectProvider.value !== 'custom')
})
btnSaveApiKey.addEventListener('click', () => {
  const key      = document.getElementById('input-apikey').value.trim()
  const provider = selectProvider.value
  const model    = document.getElementById('input-model').value.trim()
  const baseUrl  = document.getElementById('input-baseurl').value.trim()
  if (key) {
    state.ai.saveConfig({ provider, apiKey: key, model: model || 'gpt-4o', baseUrl })
    modalApiKey.classList.add('hidden')
    appendMessage('system', `✅ API Key 已保存（Provider: ${provider}）`)
  } else {
    alert('请输入有效的 API Key')
  }
})

btnClearCache.addEventListener('click', () => {
  if (confirm('确认清除所有本地缓存（API Key、草稿等）？')) {
    storageService.clearAll()
    document.getElementById('input-apikey').value = ''
    document.getElementById('input-baseurl').value = ''
    document.getElementById('input-model').value = ''
    selectProvider.value = 'openai'
    labelBaseUrl.classList.add('hidden')
    appendMessage('system', '🗑️ 本地缓存已清除')
    modalApiKey.classList.add('hidden')
  }
})

// ─── 文件导入 ────────────────────────────────────────────────────────────────
btnImport.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  fileInput.value = ''
  appendMessage('system', `📂 正在解析：${file.name}...`)
  try {
    const arrayBuffer = await file.arrayBuffer()
    const docxBytes = new Uint8Array(arrayBuffer)
    const { fullAst, aiView } = await state.pyodide.parse(docxBytes)
    state.fullAst = fullAst
    state.currentAiView = aiView
    const canvasData = aiwordToCanvas(aiView)
    state.editor.command.executeSetValue(canvasData)
    storageService.saveDraft(canvasData)
    appendMessage('system', `✅ 文档解析完成：${file.name}（${(aiView?.document?.body ?? []).length} 个段落）`)
  } catch (err) {
    appendMessage('system', `❌ 解析失败：${err.message}`)
    console.error(err)
  }
})

// ─── 其他按钮 ────────────────────────────────────────────────────────────────
btnUpdateAI.addEventListener('click', () => {
  try {
    const canvasData = state.editor.command.getValue()
    const newAiView = canvasToAiword(canvasData, state.currentAiView)
    // Guard: canvasToAiword is not fully implemented; if it produced an empty body
    // but the existing aiView has content, preserve the original body to avoid
    // sending an empty document to the AI.
    const newBody = newAiView?.document?.body ?? []
    const oldBody = state.currentAiView?.document?.body ?? []
    if (newBody.length === 0 && oldBody.length > 0 && newAiView?.document) {
      console.warn('[UpdateAI] canvasToAiword produced empty body; preserving existing body to prevent data loss.')
      newAiView.document.body = oldBody
    }
    state.currentAiView = newAiView
    // Update or insert system prompt in chat history
    const systemPrompt = {
      role: 'system',
      content: `你是一个 Word 文档编辑助手。以下是当前文档的结构化内容（JSON 格式）。请根据用户的要求修改文档，并以相同的 JSON 格式返回修改后的完整内容。\n\n${JSON.stringify(state.currentAiView, null, 2)}`,
    }
    const sysIdx = state.chatHistory.findIndex(m => m.role === 'system')
    if (sysIdx >= 0) {
      state.chatHistory[sysIdx] = systemPrompt
    } else {
      state.chatHistory.unshift(systemPrompt)
    }
    chatInput.disabled = false
    btnSend.disabled = false
    appendMessage('system', '📋 文档内容已同步到 AI 上下文，可以开始对话了')
  } catch (err) {
    appendMessage('system', `❌ 同步失败：${err.message}`)
    console.error(err)
  }
})

btnCompile.addEventListener('click', () => {
  if (!state.lastAiJson) {
    appendMessage('system', '⚠️ 还没有 AI 返回的 JSON，请先发送消息')
    return
  }
  try {
    const body = state.lastAiJson?.document?.body ?? []
    console.log('[Compile] lastAiJson paragraphs:', body.length, 'preview:', JSON.stringify(body[0] ?? {}).slice(0, 200))
    const canvasData = aiwordToCanvas(state.lastAiJson)
    const elementCount = canvasData.main?.length ?? 0
    console.log('[Compile] canvasData elements:', elementCount, 'sample:', JSON.stringify(canvasData.main?.[0] ?? {}).slice(0, 200))
    state.editor.command.executeSetValue(canvasData)
    // Explicitly re-render to ensure the canvas reflects the new data
    state.editor.command.executeForceUpdate()
    appendMessage('system', `✅ AI 内容已编译到文档（${body.length} 段落 → ${elementCount} 元素）`)
  } catch (err) {
    appendMessage('system', `❌ 编译失败：${err.message}`)
    console.error(err)
  }
})

btnExport.addEventListener('click', async () => {
  if (!state.fullAst) {
    appendMessage('system', '⚠️ 请先导入一个 .docx 文档')
    return
  }
  appendMessage('system', '💾 正在导出文档...')
  try {
    const canvasData = state.editor.command.getValue()
    const aiView = canvasToAiword(canvasData, state.currentAiView)
    const { docxBytes } = await state.pyodide.render(state.fullAst, aiView)
    const blob = new Blob([docxBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'document.docx'
    a.click()
    URL.revokeObjectURL(url)
    appendMessage('system', '✅ 文档导出成功')
  } catch (err) {
    appendMessage('system', `❌ 导出失败：${err.message}`)
    console.error(err)
  }
})

// ─── 发送消息 ─────────────────────────────────────────────────────────────────
btnSend.addEventListener('click', sendMessage)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})
async function sendMessage() {
  const text = chatInput.value.trim()
  if (!text) return
  chatInput.value = ''
  appendMessage('user', text)
  state.chatHistory.push({ role: 'user', content: text })

  // Create AI bubble to stream into
  const aiBubble = document.createElement('div')
  aiBubble.className = 'chat-bubble assistant'
  aiBubble.textContent = '⌛ 正在思考...'
  chatMessages.appendChild(aiBubble)
  chatMessages.scrollTop = chatMessages.scrollHeight

  btnSend.disabled = true
  chatInput.disabled = true

  let fullText = ''
  try {
    aiBubble.textContent = ''
    for await (const token of state.ai.streamChat(state.chatHistory)) {
      fullText += token
      aiBubble.textContent = fullText
      chatMessages.scrollTop = chatMessages.scrollHeight
    }
    state.chatHistory.push({ role: 'assistant', content: fullText })

    // Try to extract JSON from the response
    const json = state.ai.extractJSON(fullText)
    if (json) {
      state.lastAiJson = json
      btnCompile.disabled = false
      const notice = document.createElement('div')
      notice.className = 'chat-bubble system'
      notice.textContent = '✅ 检测到 JSON 内容，可点击「编译到文档」预览'
      chatMessages.appendChild(notice)
      chatMessages.scrollTop = chatMessages.scrollHeight
    }
  } catch (err) {
    aiBubble.textContent = `❌ 错误：${err.message}`
    aiBubble.style.color = '#dc2626'
    console.error(err)
  } finally {
    btnSend.disabled = false
    chatInput.disabled = false
    chatInput.focus()
  }
}

// ─── Pyodide 初始化 ───────────────────────────────────────────────────────────
async function initPyodide() {
  let progressPercent = 0
  setProgress(5, '正在初始化 Pyodide 运行时...')
  try {
    await state.pyodide.init((text) => {
      progressPercent = Math.min(progressPercent + 15, 90)
      setProgress(progressPercent, text)
    })
    setProgress(100, 'Pyodide 就绪')
    await new Promise(r => setTimeout(r, 300))
    hideProgress()
    enableToolbar()
    appendMessage('system', '✅ Pyodide 运行时就绪，可以导入 .docx 文档了')
    // Check for saved draft and offer to restore
    if (storageService.hasDraft()) {
      if (confirm('检测到上次编辑内容，是否恢复？')) {
        const draft = storageService.loadDraft()
        if (draft) {
          state.editor.command.executeSetValue(draft)
          appendMessage('system', '✅ 已恢复上次编辑内容')
        }
      }
    }
  } catch (err) {
    setProgress(100, `初始化失败：${err.message}`)
    appendMessage('system', `❌ Pyodide 初始化失败：${err.message}`)
    console.error(err)
    // Still enable toolbar so user can interact (some features won't work)
    enableToolbar()
    hideProgress()
  }
}

initPyodide()
