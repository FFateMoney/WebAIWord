import Editor from '@hufe921/canvas-editor'
import { PyodideService } from './services/pyodideService.js'
import { AIService } from './services/aiService.js'
import { storageService } from './services/storageService.js'
import { AIPatchService } from './services/aiPatchService.js'
import { aiwordToCanvas, canvasToAiword } from './adapters/aiword-to-canvas.js'

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  pyodide: new PyodideService(),
  ai: new AIService(),
  patch: new AIPatchService(),
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
const PATCH_REPAIR_MAX_RETRIES = 2

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
  btnExport.disabled   = false
  btnApiKey.disabled   = false
  btnSend.disabled     = false
  chatInput.disabled   = false
}

function syncDocumentToAIContext() {
  const canvasData = state.editor.command.getValue()
  const newAiView = canvasToAiword(canvasData.data ?? canvasData, state.currentAiView)
  state.currentAiView = newAiView
  // Update or insert system prompt in chat history
  const systemPrompt = {
    role: 'system',
    content: `你是一个 Word 文档编辑助手。以下是当前文档的结构化内容（JSON 格式）。

你的返回必须使用补丁协议 aiword.patch.v1，不允许返回完整文档。

输出协议：
{
  "protocol": "aiword.patch.v1",
  "operations": [
    // 支持操作：
    // 1) RFC6902 子集：add / replace / remove（path 为 JSON Pointer）
    // 2) 按段落 id 的扩展：insert_after_id / insert_before_id / replace_by_id / update_by_id
    //    上述操作必须提供 snake_case 字段 target_id（不要使用 targetId）
  ]
}

规则：
1) 只返回 JSON（可放在 \`\`\`json 代码块中），不要附加解释文本。
2) 只输出最小必要修改，未提及字段表示保持不变。
3) 禁止修改系统字段：document.meta、id、createdAt、updatedAt、version。
4) 所有颜色字段（如 overrides.color）必须使用 CSS 十六进制格式 "#RRGGBB"。
5) 涉及段落插入/替换时，Paragraph 节点必须包含 type、id、style、alignment、content。
6) operations 数组里的每一项都必须显式包含 op 字段，禁止省略。
7) 当需求是“添加小标题/标题段落”时，优先使用 insert_after_id 或 insert_before_id，并提供 target_id + value。

当前文档（只读）：
${JSON.stringify(state.currentAiView, null, 2)}`,
  }
  const sysIdx = state.chatHistory.findIndex(m => m.role === 'system')
  if (sysIdx >= 0) {
    state.chatHistory[sysIdx] = systemPrompt
  } else {
    state.chatHistory.unshift(systemPrompt)
  }
}

function compileLastAiJsonToDocument() {
  if (!state.lastAiJson) {
    throw new Error('还没有 AI 返回的 JSON，请先发送消息')
  }
  const canvasData = aiwordToCanvas(state.lastAiJson)
  const bodyLen = (state.lastAiJson?.document?.body ?? []).length
  const elemLen = canvasData.main?.length ?? 0
  console.log(`[Compile] ai_view body 段落数: ${bodyLen}，转换 elements 数: ${elemLen}`, (canvasData.main ?? []).slice(0, 3))
  if (bodyLen > 0 && elemLen === 0) {
    throw new Error('编译结果为空，ai_view body 有内容但转换失败，请检查段落格式')
  }
  state.editor.command.executeSetValue(canvasData)
  state.currentAiView = state.lastAiJson
}

// ─── Chat helpers ────────────────────────────────────────────────────────────
function appendMessage(role, text) {
  const bubble = document.createElement('div')
  bubble.className = `chat-bubble ${role}`
  bubble.textContent = text
  chatMessages.appendChild(bubble)
  chatMessages.scrollTop = chatMessages.scrollHeight
}

function buildPatchRepairPrompt(previousResponse, errorMessage) {
  return `你上一条回复无法被系统应用，请根据错误信息自我修正并重新输出。

错误信息：${errorMessage}

强制要求（必须全部满足）：
1) 只返回一个 JSON 对象（可放在 \`\`\`json 代码块中），禁止输出任何解释。
2) 顶层必须是：
{
  "protocol": "aiword.patch.v1",
  "operations": [ ... ]
}
3) operations 必须是数组；每一项都必须有字符串字段 op。
4) 若使用按段落 id 的操作（insert_after_id / insert_before_id / replace_by_id / update_by_id），必须使用 target_id（snake_case），不要用 targetId。
5) 只输出最小必要修改，且可被直接执行。
6) 当用户要求“添加小标题”时，通常应新增段落（insert_after_id / insert_before_id），而不是漏写 op。

你上一条原始回复（仅供修复）：
${previousResponse}`
}

function getSystemMessages() {
  return state.chatHistory.filter(m => m.role === 'system')
}

async function streamAssistantText(messages, bubble) {
  bubble.textContent = ''
  let text = ''
  for await (const token of state.ai.streamChat(messages)) {
    text += token
    bubble.textContent = text
    chatMessages.scrollTop = chatMessages.scrollHeight
  }
  return text
}

function applyAiResponseText(text) {
  const json = state.ai.extractJSON(text)
  if (!json) {
    throw new Error('AI 返回内容不是合法 JSON')
  }

  if (state.patch.isPatchEnvelope(json)) {
    const compiled = state.patch.applyPatch(state.currentAiView, json)
    state.lastAiJson = compiled
    appendMessage('system', `✅ 检测到 Patch（${json.operations.length} 条操作），正在自动编译到文档...`)
  } else if (state.patch.isAiView(json)) {
    state.lastAiJson = json
    appendMessage('system', '⚠️ 检测到完整 JSON（旧模式），将自动编译到文档；建议改用 patch 输出')
  } else {
    throw new Error('AI 返回了 JSON，但不是 patch 协议或 ai_view 文档')
  }

  compileLastAiJsonToDocument()
  appendMessage('system', '✅ AI 内容已自动编译到文档')
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

btnExport.addEventListener('click', async () => {
  appendMessage('system', '💾 正在导出文档...')
  try {
    const canvasData = state.editor.command.getValue()
    const aiView = canvasToAiword(canvasData.data ?? canvasData, state.currentAiView)
    const baseAst = state.fullAst ?? aiView
    const { docxBytes } = await state.pyodide.render(baseAst, aiView)
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

  try {
    syncDocumentToAIContext()
    appendMessage('system', '📋 已自动同步当前文档到 AI 上下文')
  } catch (err) {
    appendMessage('system', `❌ 自动同步失败：${err.message}`)
    console.error(err)
    return
  }

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

  try {
    const firstReply = await streamAssistantText(state.chatHistory, aiBubble)
    state.chatHistory.push({ role: 'assistant', content: firstReply })

    let aiTextToApply = firstReply
    for (let attempt = 0; attempt <= PATCH_REPAIR_MAX_RETRIES; attempt++) {
      try {
        applyAiResponseText(aiTextToApply)
        if (attempt > 0) {
          appendMessage('system', '✅ 已将错误自动反馈给 AI，修复后的结果已成功应用')
        }
        break
      } catch (applyErr) {
        if (attempt >= PATCH_REPAIR_MAX_RETRIES) {
          throw applyErr
        }

        appendMessage('system', `⚠️ AI 输出不合法，已自动发送错误并要求 AI 自我修正（${attempt + 1}/${PATCH_REPAIR_MAX_RETRIES}）`)
        const repairPrompt = buildPatchRepairPrompt(aiTextToApply, applyErr.message)
        const repairMessages = [
          ...getSystemMessages(),
          { role: 'assistant', content: aiTextToApply },
          { role: 'user', content: repairPrompt },
        ]

        state.chatHistory.push({ role: 'user', content: repairPrompt })
        const repairedText = await streamAssistantText(repairMessages, aiBubble)
        state.chatHistory.push({ role: 'assistant', content: repairedText })
        aiTextToApply = repairedText
      }
    }
  } catch (err) {
    aiBubble.textContent = '❌ AI 返回结构仍不合法，已终止本次应用。请重试或调整提示词。'
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
